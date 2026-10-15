import { ApiError } from "@/api/client";
import type { LessonEnv } from "./types";

/** Runs a lab step, treating "the lab is not available here" as nothing to do. */
async function labStep(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof ApiError && (e.code === "lab_unavailable" || e.status === 403)) return;
    throw e;
  }
}

/** Mining must be automatic for the scenarios (they wait for each transaction). */
export const ensureAuto = (env: LessonEnv) => labStep(() => env.api.lab.setMining("auto"));

/** Makes sure there is a chain worth looking at: at least `min` records, from the supply-chain story. */
export async function ensureRecords(env: LessonEnv, min: number): Promise<void> {
  const have = (await env.api.records({ limit: 1 })).total;
  if (have >= min) return;
  env.say("Adding a sample supply chain");
  await ensureAuto(env);
  await labStep(() => env.api.lab.runScenario("supplyChain"));
}

/** Adds one product that is already listed for sale, so the lesson can buy or reserve it. */
export async function addListedProduct(env: LessonEnv): Promise<void> {
  env.say("Listing a product for sale");
  await ensureAuto(env);
  await labStep(() => env.api.lab.runScenario("bulk", { count: 1 }));
}
