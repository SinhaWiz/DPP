import type { Lesson, LessonCtx, QuizQuestion } from "./types";

export type Phase = "preparing" | "steps" | "quiz" | "finished";

export interface LessonRun {
  lessonId: string;
  phase: Phase;
  /** Which step is showing. */
  step: number;
  /** The reading taken when the current step began; null until the first reading. */
  start: LessonCtx | null;
  /** Steps whose condition has been met (or that were read through). */
  done: boolean[];
  /** Quiz answers by question id. */
  answers: Record<string, number>;
  error: string | null;
}

export function startRun(lesson: Lesson, withSetup: boolean): LessonRun {
  return {
    lessonId: lesson.id, phase: withSetup ? "preparing" : "steps", step: 0, start: null,
    done: lesson.steps.map(() => false), answers: {}, error: null,
  };
}

/** Takes the baseline for a step the first time we see the app after it began. */
export function observe(run: LessonRun, lesson: Lesson, now: LessonCtx): LessonRun {
  if (run.phase !== "steps") return run;
  const base = run.start ?? now;
  const step = lesson.steps[run.step];
  if (!step) return run;
  const met = !step.readOnly && step.done(now, base);
  if (run.start && (run.done[run.step] || !met)) return run;
  return { ...run, start: base, done: run.done.map((d, i) => (i === run.step ? d || met : d)) };
}

/** A step may move on when its condition is met, or when it only needs reading. */
export function canAdvance(run: LessonRun, lesson: Lesson): boolean {
  const step = lesson.steps[run.step];
  return run.phase === "steps" && !!step && (!!step.readOnly || run.done[run.step] === true);
}

export function next(run: LessonRun, lesson: Lesson, now: LessonCtx): LessonRun {
  if (run.phase !== "steps" || !canAdvance(run, lesson)) return run;
  const done = run.done.map((d, i) => (i === run.step ? true : d));
  if (run.step + 1 >= lesson.steps.length) {
    return { ...run, done, phase: lesson.quiz.length > 0 ? "quiz" : "finished", start: null };
  }
  return { ...run, done, step: run.step + 1, start: now };
}

export function back(run: LessonRun, now: LessonCtx): LessonRun {
  if (run.phase === "quiz") return { ...run, phase: "steps", step: run.step, start: now };
  if (run.phase !== "steps" || run.step === 0) return run;
  return { ...run, step: run.step - 1, start: now };
}

/** Moves on regardless of the condition, for a learner who is stuck. */
export function skip(run: LessonRun, lesson: Lesson, now: LessonCtx): LessonRun {
  if (run.phase !== "steps") return run;
  return next({ ...run, done: run.done.map((d, i) => (i === run.step ? true : d)) }, lesson, now);
}

export function answer(run: LessonRun, question: QuizQuestion, choice: number): LessonRun {
  if (run.phase !== "quiz" || run.answers[question.id] !== undefined) return run; // the first answer counts
  return { ...run, answers: { ...run.answers, [question.id]: choice } };
}

export interface Score {
  correct: number;
  total: number;
  answered: number;
  complete: boolean;
}

export function score(run: LessonRun, lesson: Lesson): Score {
  const answered = lesson.quiz.filter((q) => run.answers[q.id] !== undefined).length;
  const correct = lesson.quiz.filter((q) => run.answers[q.id] === q.answer).length;
  return { correct, total: lesson.quiz.length, answered, complete: answered === lesson.quiz.length };
}

export function finish(run: LessonRun, lesson: Lesson): LessonRun {
  return run.phase === "quiz" && score(run, lesson).complete ? { ...run, phase: "finished" } : run;
}

export function setupDone(run: LessonRun, now: LessonCtx): LessonRun {
  return run.phase === "preparing" ? { ...run, phase: "steps", start: now, error: null } : run;
}

export function setupFailed(run: LessonRun, message: string): LessonRun {
  return run.phase === "preparing" ? { ...run, error: message } : run;
}
