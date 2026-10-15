import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import type { LessonEnv } from "./types";
import { addListedProduct, ensureAuto, ensureRecords } from "./setup";

const env = (over: Record<string, unknown> = {}) => {
  const api = {
    records: vi.fn(async () => ({ total: 0 })),
    lab: { setMining: vi.fn(async () => ({})), runScenario: vi.fn(async () => ({})) },
    ...over,
  };
  return { env: { api, say: vi.fn() } as unknown as LessonEnv, api: api as never as { records: ReturnType<typeof vi.fn>; lab: { setMining: ReturnType<typeof vi.fn>; runScenario: ReturnType<typeof vi.fn> } } };
};

describe("lesson setup helpers", () => {
  it("adds the supply-chain story only when the chain is too short, with mining on automatic", async () => {
    const { env: e, api } = env();
    await ensureRecords(e, 5);
    expect(api.lab.setMining).toHaveBeenCalledWith("auto");
    expect(api.lab.runScenario).toHaveBeenCalledWith("supplyChain");
    expect(e.say).toHaveBeenCalledWith("Adding a sample supply chain");
  });

  it("leaves a chain that is already long enough alone", async () => {
    const { env: e, api } = env({ records: vi.fn(async () => ({ total: 12 })) });
    await ensureRecords(e, 5);
    expect(api.lab.runScenario).not.toHaveBeenCalled();
  });

  it("lists one product for the learner to buy", async () => {
    const { env: e, api } = env();
    await addListedProduct(e);
    expect(api.lab.runScenario).toHaveBeenCalledWith("bulk", { count: 1 });
  });

  it("carries on quietly where the lab is not available", async () => {
    const off = new ApiError(403, "lab_unavailable", "Lab features are disabled");
    const { env: e } = env({ lab: { setMining: vi.fn().mockRejectedValue(off), runScenario: vi.fn().mockRejectedValue(off) } });
    await expect(ensureAuto(e)).resolves.toBeUndefined();
    await expect(ensureRecords(e, 3)).resolves.toBeUndefined();
    await expect(addListedProduct(e)).resolves.toBeUndefined();
  });

  it("does not hide other failures", async () => {
    const { env: e } = env({ lab: { setMining: vi.fn(), runScenario: vi.fn().mockRejectedValue(new ApiError(500, "internal", "Internal error")) } });
    await expect(ensureRecords(e, 3)).rejects.toThrow("Internal error");
  });
});
