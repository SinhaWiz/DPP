import { describe, expect, it } from "vitest";
import { answer, back, canAdvance, finish, next, observe, score, setupDone, setupFailed, skip, startRun } from "./engine";
import { SAMPLE, ctx } from "./testing";

const L = SAMPLE;

describe("starting", () => {
  it("begins at the first step, or preparing when the lesson sets things up", () => {
    expect(startRun(L, false)).toMatchObject({ phase: "steps", step: 0, start: null, done: [false, false, false] });
    expect(startRun(L, true).phase).toBe("preparing");
  });

  it("moves from preparing to the steps, taking a baseline", () => {
    const run = setupDone(startRun(L, true), ctx({ records: 4 }));
    expect(run.phase).toBe("steps");
    expect(run.start!.records).toBe(4);
    expect(setupDone(run, ctx())).toBe(run); // only from preparing
  });

  it("records a setup failure without leaving the preparing phase", () => {
    const run = setupFailed(startRun(L, true), "node down");
    expect(run).toMatchObject({ phase: "preparing", error: "node down" });
  });
});

describe("observing progress", () => {
  it("takes the first reading as the baseline and does not count what was already true", () => {
    let run = startRun(L, false);
    run = observe(run, L, ctx({ records: 3 }));
    expect(run.start!.records).toBe(3);
    expect(run.done[0]).toBe(false);
  });

  it("a reading step never completes by itself, but can always advance", () => {
    const run = observe(startRun(L, false), L, ctx());
    expect(run.done[0]).toBe(false);
    expect(canAdvance(run, L)).toBe(true);
  });

  it("a doing step completes when the app changes relative to when the step began", () => {
    let run = observe(startRun(L, false), L, ctx({ records: 2 }));
    run = next(run, L, ctx({ records: 2 }));                    // step 2 begins with 2 records
    run = observe(run, L, ctx({ records: 2 }));
    expect(canAdvance(run, L)).toBe(false);
    run = observe(run, L, ctx({ records: 3 }));
    expect(run.done[1]).toBe(true);
    expect(canAdvance(run, L)).toBe(true);
  });

  it("stays complete once done, even if the condition stops being true", () => {
    let run = next(observe(startRun(L, false), L, ctx({ records: 1 })), L, ctx({ records: 1 }));
    run = observe(observe(run, L, ctx({ records: 1 })), L, ctx({ records: 2 }));
    run = observe(run, L, ctx({ records: 1 }));
    expect(run.done[1]).toBe(true);
  });

  it("does nothing outside the steps phase", () => {
    const run = startRun(L, true);
    expect(observe(run, L, ctx())).toBe(run);
  });
});

describe("moving through the lesson", () => {
  const atStep = (n: number) => {
    let run = observe(startRun(L, false), L, ctx());
    for (let i = 0; i < n; i++) {
      run = skip(run, L, ctx());
    }
    return run;
  };

  it("will not advance a doing step until it is done", () => {
    const run = atStep(1);
    expect(next(run, L, ctx())).toBe(run);
  });

  it("advances once the step is done and takes a fresh baseline", () => {
    let run = atStep(1);
    run = observe(run, L, ctx({ records: 1 }));
    run = observe(run, L, ctx({ records: 5 }));
    const moved = next(run, L, ctx({ records: 5 }));
    expect(moved.step).toBe(2);
    expect(moved.start!.records).toBe(5);
  });

  it("goes back a step", () => {
    const run = atStep(1);
    expect(back(run, ctx()).step).toBe(0);
    expect(back(startRun(L, false), ctx()).step).toBe(0);
  });

  it("skipping marks the step done and moves on", () => {
    const run = skip(atStep(1), L, ctx());
    expect(run.step).toBe(2);
    expect(run.done[1]).toBe(true);
  });

  it("after the last step it goes to the quiz, or finishes when there is none", () => {
    const end = skip(atStep(2), L, ctx());
    expect(end.phase).toBe("quiz");
    const noQuiz = { ...L, quiz: [] };
    const run = skip(skip(skip(observe(startRun(noQuiz, false), noQuiz, ctx()), noQuiz, ctx()), noQuiz, ctx()), noQuiz, ctx());
    expect(run.phase).toBe("finished");
  });

  it("can go back from the quiz to the last step", () => {
    const quiz = skip(atStep(2), L, ctx());
    expect(back(quiz, ctx())).toMatchObject({ phase: "steps", step: 2 });
  });
});

describe("the quiz", () => {
  const quiz = () => skip(skip(skip(observe(startRun(L, false), L, ctx()), L, ctx()), L, ctx()), L, ctx());

  it("keeps the first answer to each question", () => {
    let run = quiz();
    expect(run.phase).toBe("quiz");
    run = answer(run, L.quiz[0]!, 2);
    run = answer(run, L.quiz[0]!, 1);      // changing your mind does not count
    expect(run.answers).toEqual({ q1: 2 });
  });

  it("scores right answers and knows when every question has been answered", () => {
    let run = quiz();
    run = answer(run, L.quiz[0]!, 1);
    expect(score(run, L)).toEqual({ correct: 1, total: 2, answered: 1, complete: false });
    expect(finish(run, L).phase).toBe("quiz");
    run = answer(run, L.quiz[1]!, 1);
    expect(score(run, L)).toEqual({ correct: 1, total: 2, answered: 2, complete: true });
    expect(finish(run, L).phase).toBe("finished");
  });

  it("ignores answers outside the quiz", () => {
    const run = startRun(L, false);
    expect(answer(run, L.quiz[0]!, 1)).toBe(run);
  });
});
