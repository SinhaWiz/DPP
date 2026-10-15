import { aSaleStepByStep, pushVsPullPayments, rulesAndReverts, threeWaysToTakeSomethingBack } from "./content/transactions";
import { breakingTheChain, whereRecordsLive } from "./content/inspection";
import { followingAProduct, makingAChain, whatIsABlock } from "./content/foundations";
import type { Lesson } from "./types";

/** Every lesson, in teaching order. */
export const LESSONS: Lesson[] = [
  whatIsABlock,
  makingAChain,
  aSaleStepByStep,
  rulesAndReverts,
  threeWaysToTakeSomethingBack,
  pushVsPullPayments,
  whereRecordsLive,
  breakingTheChain,
  followingAProduct,
];

export const lessonById = (id: string, lessons: Lesson[] = LESSONS): Lesson | undefined => lessons.find((l) => l.id === id);
