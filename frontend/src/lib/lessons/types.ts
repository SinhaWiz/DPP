import type { Api } from "@/api/client";

/** A reading of the app at one moment: everything a lesson step can ask about. */
export interface LessonCtx {
  /** Current page, e.g. "/tamper". */
  route: string;
  records: number;
  products: number;
  txCount: number;
  failedTxs: number;
  pendingTxs: number;
  /** "auto" | "manual" | "interval", or null when the lab is off. */
  mining: string | null;
  /** The record whose detail is open. */
  selected: bigint | null;
  followedProduct: string | null;
  /** Address of whoever is acting, lower-cased. */
  actingAs: string | null;
  /** Stage of the most recent transaction started in this browser. */
  activeStage: string | null;
  /** How many transactions started in this browser reached each stage. */
  reached: { simulated: number; pending: number; mined: number; failed: number; revoked: number };
  /** The browser's own verdict on the whole ledger. */
  verifyValid: boolean;
  brokenRecords: number;
  /** Lab messages seen since the page opened: tampers and restores. */
  tampers: number;
  restores: number;
  /** Of the tampers seen, how many fooled the contract's own check. */
  fooled: number;
  /** Count of messages of each type seen since the page opened. */
  events: Record<string, number>;
}

export interface LessonStep {
  id: string;
  title: string;
  /** What to do or notice, in plain English with [[glossary]] markers. */
  instruction: string;
  /** CSS selector of the part of the page to highlight. */
  target?: string;
  /** True once the learner has done it. `start` is the reading taken when the step began. */
  done: (now: LessonCtx, start: LessonCtx) => boolean;
  /** Said when the learner seems stuck. */
  hint?: string;
  /** A step that only needs reading is done when the learner presses Next. */
  readOnly?: boolean;
}

export interface QuizQuestion {
  id: string;
  question: string;
  choices: string[];
  /** Index of the right choice. */
  answer: number;
  /** Shown after answering, right or wrong. */
  explanation: string;
}

export interface LessonEnv {
  api: Api;
  /** Reports what the setup is doing. */
  say(message: string): void;
}

export interface Lesson {
  id: string;
  title: string;
  summary: string;
  minutes: number;
  /** Needs the local chain's lab (step mode, tampering, time travel). */
  needsLab?: boolean;
  /** Prepares a known starting state. Runs once, when the lesson starts. */
  setup?: (env: LessonEnv) => Promise<void>;
  steps: LessonStep[];
  quiz: QuizQuestion[];
}
