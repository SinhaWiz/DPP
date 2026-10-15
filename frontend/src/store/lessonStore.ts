import { create } from "zustand";
import { safeStorage } from "@/lib/safeStorage";
import {
  answer as answerQuestion, back, finish, next, observe, score, setupDone, setupFailed, skip, startRun, type LessonRun,
} from "@/lib/lessons/engine";
import type { Lesson, LessonCtx, LessonEnv } from "@/lib/lessons/types";

const KEY = "ledger-lab.lessons.v1";

export interface Progress {
  completedAt: number;
  correct: number;
  total: number;
}

function load(): Record<string, Progress> {
  try {
    const raw = safeStorage.get(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Partial<Progress>>;
    const out: Record<string, Progress> = {};
    for (const [id, p] of Object.entries(parsed)) {
      if (p && typeof p.completedAt === "number" && typeof p.correct === "number" && typeof p.total === "number") out[id] = p as Progress;
    }
    return out;
  } catch {
    return {};
  }
}

interface LessonState {
  run: LessonRun | null;
  progress: Record<string, Progress>;
  /** What the setup of the running lesson is doing right now. */
  status: string | null;

  start(lesson: Lesson, env: LessonEnv, now: LessonCtx): Promise<void>;
  observe(lesson: Lesson, now: LessonCtx): void;
  next(lesson: Lesson, now: LessonCtx): void;
  back(now: LessonCtx): void;
  skip(lesson: Lesson, now: LessonCtx): void;
  answer(lesson: Lesson, questionId: string, choice: number): void;
  finish(lesson: Lesson): void;
  exit(): void;
  resetProgress(): void;
}

export const useLessons = create<LessonState>((set, get) => {
  const savedProgress = (progress: Record<string, Progress>) => {
    safeStorage.set(KEY, JSON.stringify(progress));
    return progress;
  };
  const patch = (fn: (run: LessonRun) => LessonRun) => {
    const run = get().run;
    if (run) set({ run: fn(run) });
  };

  return {
    run: null,
    progress: load(),
    status: null,

    async start(lesson, env, now) {
      set({ run: startRun(lesson, !!lesson.setup), status: null });
      if (!lesson.setup) {
        patch((r) => setupDone({ ...r, phase: "preparing" }, now));
        return;
      }
      try {
        await lesson.setup({ ...env, say: (m) => { env.say(m); set({ status: m }); } });
        // the lesson may have been exited while it was preparing
        if (get().run?.lessonId === lesson.id) patch((r) => setupDone(r, now));
      } catch (e) {
        if (get().run?.lessonId === lesson.id) patch((r) => setupFailed(r, e instanceof Error ? e.message : String(e)));
      } finally {
        set({ status: null });
      }
    },

    observe: (lesson, now) => patch((r) => (r.lessonId === lesson.id ? observe(r, lesson, now) : r)),
    next: (lesson, now) => patch((r) => next(r, lesson, now)),
    back: (now) => patch((r) => back(r, now)),
    skip: (lesson, now) => patch((r) => skip(r, lesson, now)),
    answer: (lesson, questionId, choice) => {
      const q = lesson.quiz.find((x) => x.id === questionId);
      if (q) patch((r) => answerQuestion(r, q, choice));
    },

    finish(lesson) {
      const run = get().run;
      if (!run) return;
      const finished = finish(run, lesson);
      if (finished.phase !== "finished") return;
      const s = score(finished, lesson);
      set({
        run: finished,
        progress: savedProgress({ ...get().progress, [lesson.id]: { completedAt: Date.now(), correct: s.correct, total: s.total } }),
      });
    },

    exit: () => set({ run: null, status: null }),
    resetProgress: () => set({ progress: savedProgress({}) }),
  };
});
