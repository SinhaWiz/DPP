import { beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE, ctx } from "@/lib/lessons/testing";
import type { Lesson, LessonEnv } from "@/lib/lessons/types";
import { useTally } from "./eventTally";
import { useLessons } from "./lessonStore";
import { msg } from "@/test/fakes";

const env = (): LessonEnv => ({ api: {} as never, say: vi.fn() });
const reset = () => { window.localStorage.clear(); useLessons.setState({ run: null, progress: {}, status: null }); };
beforeEach(reset);

describe("lesson store: running", () => {
  it("starts a lesson without setup straight on its first step", async () => {
    await useLessons.getState().start(SAMPLE, env(), ctx({ records: 2 }));
    const run = useLessons.getState().run!;
    expect(run).toMatchObject({ lessonId: "sample", phase: "steps", step: 0 });
    expect(run.start!.records).toBe(2);
  });

  it("runs the setup first and reports what it is doing", async () => {
    const seen: (string | null)[] = [];
    const unsub = useLessons.subscribe((s) => seen.push(s.status));
    const lesson: Lesson = { ...SAMPLE, setup: async (e) => { e.say("Registering a laptop"); await Promise.resolve(); } };
    const e = env();
    const promise = useLessons.getState().start(lesson, e, ctx());
    expect(useLessons.getState().run!.phase).toBe("preparing");
    await promise;
    unsub();
    expect(seen).toContain("Registering a laptop");
    expect(e.say).toHaveBeenCalledWith("Registering a laptop");
    expect(useLessons.getState().run!.phase).toBe("steps");
    expect(useLessons.getState().status).toBeNull();
  });

  it("keeps the learner on the preparing screen, with the reason, if the setup fails", async () => {
    const lesson: Lesson = { ...SAMPLE, setup: async () => { throw new Error("the lab is off"); } };
    await useLessons.getState().start(lesson, env(), ctx());
    expect(useLessons.getState().run).toMatchObject({ phase: "preparing", error: "the lab is off" });
  });

  it("does not resume a lesson that was exited while it was preparing", async () => {
    let release!: () => void;
    const lesson: Lesson = { ...SAMPLE, setup: () => new Promise<void>((r) => { release = r; }) };
    const p = useLessons.getState().start(lesson, env(), ctx());
    useLessons.getState().exit();
    release();
    await p;
    expect(useLessons.getState().run).toBeNull();
  });

  it("moves through steps as the app changes", async () => {
    const s = useLessons.getState();
    await s.start(SAMPLE, env(), ctx());
    s.next(SAMPLE, ctx());                                  // the reading step
    useLessons.getState().observe(SAMPLE, ctx());
    useLessons.getState().observe(SAMPLE, ctx({ records: 1 }));
    expect(useLessons.getState().run!.done[1]).toBe(true);
    useLessons.getState().next(SAMPLE, ctx({ records: 1 }));
    expect(useLessons.getState().run!.step).toBe(2);
    useLessons.getState().back(ctx());
    expect(useLessons.getState().run!.step).toBe(1);
  });

  it("ignores readings meant for a different lesson", async () => {
    await useLessons.getState().start(SAMPLE, env(), ctx());
    const before = useLessons.getState().run;
    useLessons.getState().observe({ ...SAMPLE, id: "other" }, ctx({ records: 9 }));
    expect(useLessons.getState().run).toBe(before);
  });
});

describe("lesson store: quiz and progress", () => {
  async function toQuiz() {
    await useLessons.getState().start(SAMPLE, env(), ctx());
    for (let i = 0; i < 3; i++) useLessons.getState().skip(SAMPLE, ctx());
    expect(useLessons.getState().run!.phase).toBe("quiz");
  }

  it("records a finished lesson with its score, and saves it", async () => {
    await toQuiz();
    useLessons.getState().answer(SAMPLE, "q1", 1);
    useLessons.getState().answer(SAMPLE, "q2", 1);
    useLessons.getState().finish(SAMPLE);
    expect(useLessons.getState().run!.phase).toBe("finished");
    expect(useLessons.getState().progress.sample).toMatchObject({ correct: 1, total: 2 });
    expect(JSON.parse(window.localStorage.getItem("ledger-lab.lessons.v1")!).sample.total).toBe(2);
  });

  it("does not finish until every question is answered", async () => {
    await toQuiz();
    useLessons.getState().answer(SAMPLE, "q1", 1);
    useLessons.getState().finish(SAMPLE);
    expect(useLessons.getState().run!.phase).toBe("quiz");
    expect(useLessons.getState().progress.sample).toBeUndefined();
  });

  it("ignores an answer to a question that does not exist", async () => {
    await toQuiz();
    useLessons.getState().answer(SAMPLE, "nope", 0);
    expect(useLessons.getState().run!.answers).toEqual({});
  });

  it("exiting leaves the saved progress alone, and progress can be reset", async () => {
    await toQuiz();
    useLessons.getState().answer(SAMPLE, "q1", 1);
    useLessons.getState().answer(SAMPLE, "q2", 0);
    useLessons.getState().finish(SAMPLE);
    useLessons.getState().exit();
    expect(useLessons.getState().run).toBeNull();
    expect(useLessons.getState().progress.sample).toBeDefined();
    useLessons.getState().resetProgress();
    expect(useLessons.getState().progress).toEqual({});
    expect(window.localStorage.getItem("ledger-lab.lessons.v1")).toBe("{}");
  });

  it("keeps working when storage is unavailable", async () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    await toQuiz();
    useLessons.getState().answer(SAMPLE, "q1", 1);
    useLessons.getState().answer(SAMPLE, "q2", 0);
    useLessons.getState().finish(SAMPLE);
    expect(useLessons.getState().progress.sample).toBeDefined();   // remembered for this visit at least
    vi.restoreAllMocks();
  });
});

describe("event tally", () => {
  beforeEach(() => useTally.getState().clear());

  it("counts messages by type, tampers, restores, and tampers that fooled the contract", () => {
    const t = useTally.getState();
    t.record(msg("block.new"));
    t.record(msg("block.new"));
    t.record(msg("lab.tampered", { onChain: { valid: false }, offChain: { valid: false } }));
    t.record(msg("lab.tampered", { onChain: { valid: true }, offChain: { valid: false } }));
    t.record(msg("lab.restored"));
    const s = useTally.getState();
    expect(s.events).toMatchObject({ "block.new": 2, "lab.tampered": 2, "lab.restored": 1 });
    expect([s.tampers, s.restores, s.fooled]).toEqual([2, 1, 1]);
  });
});
