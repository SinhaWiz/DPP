import { describe, expect, it } from "vitest";
import { GLOSSARY, parseRich } from "@/lib/glossary";
import { LESSON_TITLES } from "@/lib/lessonTitles";
import { LESSONS, lessonById } from "./index";
import { canAdvance, next, observe, score, startRun, answer, type LessonRun } from "./engine";
import { ctx } from "./testing";
import type { Lesson, LessonCtx } from "./types";

describe("lesson content: structure", () => {
  it("has the nine lessons of the roadmap, in order, each with the id and title narration links to", () => {
    expect(LESSONS.map((l) => l.id)).toEqual([
      "what-is-a-block", "making-a-chain", "a-sale-step-by-step", "rules-and-reverts", "three-ways-to-take-something-back",
      "push-vs-pull-payments", "where-records-live", "breaking-the-chain", "following-a-product",
    ]);
    expect(Object.keys(LESSON_TITLES).sort()).toEqual(LESSONS.map((l) => l.id).sort());
    for (const l of LESSONS) expect(l.title, l.id).toBe(LESSON_TITLES[l.id]);
    expect(lessonById("breaking-the-chain")?.title).toBe("Breaking the chain");
    expect(lessonById("nope")).toBeUndefined();
  });

  it("marks the lessons that need the local lab", () => {
    expect(LESSONS.filter((l) => l.needsLab).map((l) => l.id)).toEqual([
      "a-sale-step-by-step", "rules-and-reverts", "three-ways-to-take-something-back", "push-vs-pull-payments", "breaking-the-chain",
    ]);
  });

  it.each(LESSONS.map((l) => [l.id, l] as const))("%s is complete", (_id, l) => {
    expect(l.summary.length).toBeGreaterThan(20);
    expect(l.minutes).toBeGreaterThan(0);
    expect(l.steps.length).toBeGreaterThanOrEqual(4);
    expect(new Set(l.steps.map((s) => s.id)).size).toBe(l.steps.length);
    for (const s of l.steps) {
      expect(s.title.length, `${l.id}/${s.id} title`).toBeGreaterThan(2);
      expect(s.instruction.length, `${l.id}/${s.id} instruction`).toBeGreaterThan(20);
    }
    expect(l.quiz.length).toBeGreaterThanOrEqual(2);
    expect(new Set(l.quiz.map((q) => q.id)).size).toBe(l.quiz.length);
    for (const q of l.quiz) {
      expect(q.choices.length, q.id).toBeGreaterThanOrEqual(2);
      expect(q.answer, q.id).toBeGreaterThanOrEqual(0);
      expect(q.answer, q.id).toBeLessThan(q.choices.length);
      expect(new Set(q.choices).size, q.id).toBe(q.choices.length);
      expect(q.explanation.length, q.id).toBeGreaterThan(20);
    }
  });

  it("only points at parts of the page with valid selectors", () => {
    for (const l of LESSONS) for (const s of l.steps) if (s.target) expect(() => document.querySelector(s.target!), `${l.id}/${s.id}`).not.toThrow();
  });

  it("uses glossary markers that exist and are well-formed", () => {
    const known = new Set(GLOSSARY.map((g) => g.id));
    const texts = LESSONS.flatMap((l) => [l.summary, ...l.steps.flatMap((s) => [s.instruction, s.hint ?? ""]), ...l.quiz.flatMap((q) => [q.question, q.explanation])]);
    for (const t of texts) {
      for (const m of t.matchAll(/\[\[([a-z0-9]+)(?:\|[^\]]*)?\]\]/g)) expect(known.has(m[1]!), `${m[1]} in "${t.slice(0, 50)}"`).toBe(true);
      expect(parseRich(t).filter((p) => p.kind === "text").some((p) => p.text.includes("[[")), t.slice(0, 50)).toBe(false);
    }
  });

  it("gives every doing step a hint-free but achievable condition (never complete on its own)", () => {
    // Identical readings must not complete a step that is meant to be done by the learner.
    const neutral = ctx({ mining: null });
    for (const l of LESSONS) {
      for (const s of l.steps.filter((x) => !x.readOnly)) {
        // steps that check a *state* rather than a change (a page, or a mode) are legitimately true in that state
        const stateBased = /route|mining|actingAs|followedProduct|search|selected/.test(s.done.toString());
        if (!stateBased) expect(s.done(neutral, neutral), `${l.id}/${s.id}`).toBe(false);
      }
    }
  });
});

// ─────────────── a scripted learner works through every lesson ───────────────

type Patch = Partial<LessonCtx>;
/** For each doing step: the state just before the learner acts, and the state after. */
const SCRIPTS: Record<string, Record<string, { before: Patch; after: Patch }>> = {
  "what-is-a-block": {
    explorer: { before: { route: "/learn" }, after: { route: "/" } },
    click: { before: {}, after: { selected: 2n } },
  },
  "making-a-chain": {
    actas: { before: {}, after: { actingAs: "0xabc" } },
    register: { before: { records: 3 }, after: { records: 4 } },
    check: { before: {}, after: { selected: 3n } },
  },
  "a-sale-step-by-step": {
    "step-mode": { before: { mining: "auto" }, after: { mining: "manual" } },
    actas: { before: {}, after: { actingAs: "0xabc" } },
    buy: { before: { mining: "manual" }, after: { mining: "manual", reached: { simulated: 1, pending: 1, mined: 0, failed: 0, revoked: 0 } } },
    waiting: { before: { mining: "manual", pendingTxs: 0 }, after: { mining: "manual", pendingTxs: 1 } },
    mine: { before: { mining: "manual", pendingTxs: 1, records: 4 }, after: { mining: "manual", pendingTxs: 0, records: 5 } },
    auto: { before: { mining: "manual" }, after: { mining: "auto" } },
  },
  "rules-and-reverts": {
    first: { before: { failedTxs: 0 }, after: { failedTxs: 1 } },
    another: { before: { failedTxs: 1, records: 8 }, after: { failedTxs: 2, records: 8 } },
  },
  "three-ways-to-take-something-back": {
    delist: { before: {}, after: { minedByFn: { cancelListing: 1 } } },
    relist: { before: { minedByFn: { cancelListing: 1 } }, after: { minedByFn: { cancelListing: 1, listForSale: 1 } } },
    reserve: { before: { minedByFn: { listForSale: 1 } }, after: { minedByFn: { listForSale: 1, reserve: 1 } } },
    revoke: { before: { minedByFn: { reserve: 1 } }, after: { minedByFn: { reserve: 1, revokeReservation: 1 } } },
    "step-mode": { before: { mining: "auto" }, after: { mining: "manual" } },
    send: { before: { pendingTxs: 0 }, after: { pendingTxs: 1 } },
    cancel: { before: { events: {} }, after: { events: { "tx.replaced": 1 } } },
    auto: { before: { mining: "manual", pendingTxs: 1 }, after: { mining: "auto", pendingTxs: 0 } },
  },
  "push-vs-pull-payments": {
    scenario: { before: { failedTxs: 0 }, after: { failedTxs: 15 } },
    pull: { before: {}, after: { minedByFn: { withdraw: 1 } } },
  },
  "where-records-live": {
    open: { before: { route: "/" }, after: { route: "/storage" } },
    pick: { before: { route: "/storage" }, after: { route: "/storage", search: "?record=2" } },
  },
  "breaking-the-chain": {
    open: { before: { route: "/" }, after: { route: "/tamper" } },
    level1: { before: {}, after: { tampers: 1, brokenRecords: 1, verifyValid: false } },
    undo: { before: { tampers: 1, brokenRecords: 1 }, after: { tampers: 1, restores: 1, brokenRecords: 0 } },
    level3: { before: { tampers: 1, restores: 1 }, after: { tampers: 2, restores: 1, fooled: 1, brokenRecords: 4 } },
    restore: { before: { restores: 1, brokenRecords: 4 }, after: { restores: 2, brokenRecords: 0 } },
  },
  "following-a-product": {
    explorer: { before: { route: "/tamper" }, after: { route: "/" } },
    follow: { before: {}, after: { followedProduct: "1" } },
    step: { before: { selected: 2n }, after: { selected: 5n } },
  },
};

/** Plays a lesson as a learner would, checking each doing step only completes when they act. */
function walk(lesson: Lesson, script: (typeof SCRIPTS)[string]): LessonCtx {
  let state = ctx({ route: "/learn" }); // lessons are started from the Learn page
  let run = startRun(lesson, false);
  run = observe(run, lesson, state);
  for (const step of lesson.steps) {
    if (step.readOnly) {
      expect(canAdvance(run, lesson), `${lesson.id}/${step.id} can be read through`).toBe(true);
    } else {
      const s = script[step.id];
      expect(s, `${lesson.id}/${step.id} has a script`).toBeDefined();
      state = { ...state, ...s!.before };
      run = { ...run, start: state };                                              // the step began in this state
      run = observe(run, lesson, state);
      expect(run.done[run.step], `${lesson.id}/${step.id} is not done before the learner acts`).toBe(false);
      expect(canAdvance(run, lesson), `${lesson.id}/${step.id} cannot be skipped past`).toBe(false);
      state = { ...state, ...s!.after };
      run = observe(run, lesson, state);
      expect(run.done[run.step], `${lesson.id}/${step.id} completes when the learner acts`).toBe(true);
    }
    run = next(run, lesson, state);
  }
  return state;
}

describe("lesson content: a learner works through each lesson", () => {
  it("has a script for every doing step (so a new step cannot be added untested)", () => {
    for (const l of LESSONS) {
      const doing = l.steps.filter((s) => !s.readOnly).map((s) => s.id).sort();
      expect(Object.keys(SCRIPTS[l.id] ?? {}).sort(), l.id).toEqual(doing);
    }
  });

  it.each(LESSONS.map((l) => [l.id, l] as const))("%s: every step completes when the learner does the thing", (_id, lesson) => {
    walk(lesson, SCRIPTS[lesson.id]!);
  });

  it.each(LESSONS.map((l) => [l.id, l] as const))("%s: the quiz can be passed with full marks", (_id, lesson) => {
    let run: LessonRun = { ...startRun(lesson, false), phase: "quiz" };
    for (const q of lesson.quiz) run = answer(run, q, q.answer);
    expect(score(run, lesson)).toEqual({ correct: lesson.quiz.length, total: lesson.quiz.length, answered: lesson.quiz.length, complete: true });
  });
});
