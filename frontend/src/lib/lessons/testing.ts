import type { Lesson, LessonCtx } from "./types";

/** A reading of an empty, healthy app, for tests. */
export function ctx(over: Partial<LessonCtx> = {}): LessonCtx {
  return {
    route: "/", search: "", records: 0, products: 0, txCount: 0, failedTxs: 0, pendingTxs: 0, mining: "auto", selected: null, followedProduct: null, actingAs: null,
    activeStage: null, reached: { simulated: 0, pending: 0, mined: 0, failed: 0, revoked: 0 }, minedByFn: {}, verifyValid: true, brokenRecords: 0,
    tampers: 0, restores: 0, fooled: 0, events: {}, ...over,
  };
}

/** A small lesson with one of each kind of step. */
export const SAMPLE: Lesson = {
  id: "sample", title: "Sample", summary: "s", minutes: 1,
  steps: [
    { id: "read", title: "Read", instruction: "Just read.", readOnly: true, done: () => false },
    { id: "register", title: "Register", instruction: "Register a product.", done: (n, s) => n.records > s.records },
    { id: "open", title: "Open", instruction: "Open a record.", done: (n) => n.selected !== null },
  ],
  quiz: [
    { id: "q1", question: "?", choices: ["a", "b", "c"], answer: 1, explanation: "because b" },
    { id: "q2", question: "??", choices: ["x", "y"], answer: 0, explanation: "because x" },
  ],
};
