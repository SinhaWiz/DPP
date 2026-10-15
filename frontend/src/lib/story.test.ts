import { describe, expect, it, vi } from "vitest";
import { parseEther } from "ethers";
import { marketInterface } from "@dpp/shared";
import { TxFlow } from "@/store/txFlow";
import { parseRich } from "./glossary";
import { STORY, StoryError, playStory, type StoryEnv } from "./story";

const HASH = "0x" + "ab".repeat(32);
const stage = (key: string) => ({ key, label: key, at: 1, done: true, current: false, detail: {} });

function setup(opts: { automine?: boolean; failAt?: number; neverFinish?: boolean; productCount?: number } = {}) {
  const sent: { fn: string; args: unknown[]; value?: bigint; as: number }[] = [];
  let actor = -1;
  let n = 0;
  const market = {
    simulate: vi.fn(async () => ({ ok: true }) as never),
    send: vi.fn(async (fn: string, args: unknown[], o: { value?: bigint }) => {
      sent.push({ fn, args, value: o.value, as: actor });
      n++;
      return { hash: HASH.replace("ab", n.toString(16).padStart(2, "0")), nonce: n, response: { wait: vi.fn() } } as never;
    }),
  };
  const flow = new TxFlow({
    api: {
      tx: vi.fn(async (hash: string) => {
        if (opts.neverFinish) return { hash, state: "pending", nonce: 1, stages: [stage("pending")] } as never;
        const index = parseInt(hash.slice(2, 4), 16);
        const failed = opts.failAt === index;
        return { hash, state: failed ? "failed" : "mined", nonce: index, stages: [stage("pending"), stage("mined")], explanation: null } as never;
      }),
    } as never,
    market: () => market as never,
    who: () => ({ address: "0x" + String(Math.max(actor, 0)).padStart(40, "0"), role: null }),
  });

  const steps: number[] = [];
  const sleeps: number[] = [];
  const env: StoryEnv = {
    productCount: opts.productCount ?? 4, automine: opts.automine ?? true, flow,
    actAs: async (role) => { actor = role; },
    sleep: async (ms) => { sleeps.push(ms); },
    onStep: (i) => steps.push(i),
    pauseMs: 100,
  };
  return { env, sent, steps, sleeps, flow, market };
}

describe("STORY", () => {
  it("passes a laptop from the manufacturer through four owners, with both ways of selling", () => {
    expect(STORY.map((s) => `${s.roleName}:${s.fn}`)).toEqual([
      "Manufacturer:registerProduct", "Manufacturer:listForSale", "Distributor:buy", "Distributor:listForSale", "Retailer:reserve",
      "Distributor:confirmSale", "Distributor:withdraw", "Retailer:listForSale", "Customer:buy",
    ]);
  });

  it("pays the listed price every time money is sent", () => {
    const price = (fn: string, from: number) => STORY.filter((s) => s.fn === fn)[from]!;
    expect(price("buy", 0).value).toBe(parseEther("1"));
    expect(price("reserve", 0).value).toBe(parseEther("1.5"));
    expect(price("buy", 1).value).toBe(parseEther("2"));
    expect(STORY.filter((s) => !["buy", "reserve"].includes(s.fn)).every((s) => s.value === undefined)).toBe(true);
  });

  it("explains every step, using glossary words that exist", () => {
    for (const s of STORY) {
      expect(s.caption.length).toBeGreaterThan(30);
      for (const p of parseRich(s.caption)) if (p.kind === "text") expect(p.text).not.toContain("[[");
    }
  });

  it("only calls functions the contract has, with the number of arguments each takes", () => {
    for (const s of STORY) {
      const fragment = marketInterface.getFunction(s.fn);
      expect(fragment, s.fn).not.toBeNull();
      expect(s.args(7n), s.fn).toHaveLength(fragment!.inputs.length);
    }
  });
});

describe("playStory", () => {
  it("sends every step as the right person, against the product it created", async () => {
    const { env, sent } = setup({ productCount: 4 });
    const { productId } = await playStory(env);
    expect(productId).toBe(5n);
    expect(sent.map((s) => `${s.as}:${s.fn}`)).toEqual(["0:registerProduct", "0:listForSale", "1:buy", "1:listForSale", "2:reserve", "1:confirmSale", "1:withdraw", "2:listForSale", "3:buy"]);
    expect(sent[0]!.args).toEqual(["Story laptop"]);
    expect(sent[2]!.args).toEqual([5n]);
    expect(sent[2]!.value).toBe(parseEther("1"));
    expect(sent[6]!.args).toEqual([]);
  });

  it("announces each step before it runs and pauses between steps", async () => {
    const { env, steps, sleeps } = setup();
    await playStory(env);
    expect(steps).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(sleeps.filter((ms) => ms === 100)).toHaveLength(9);
  });

  it("refuses to start when mining is not automatic", async () => {
    const { env, sent } = setup({ automine: false });
    await expect(playStory(env)).rejects.toThrow(/Switch mining back to Auto/);
    expect(sent).toHaveLength(0);
  });

  it("stops when asked, without sending anything more", async () => {
    const controller = new AbortController();
    const { env, sent } = setup();
    env.signal = controller.signal;
    env.onStep = (i) => { if (i === 3) controller.abort(); };
    await expect(playStory(env)).rejects.toThrow("Stopped.");
    expect(sent.length).toBeLessThanOrEqual(4);
    expect(sent.length).toBeGreaterThanOrEqual(3);
  });

  it("stops with a clear message if a step fails, and does not carry on", async () => {
    const { env, sent } = setup({ failAt: 3 });
    const err = await playStory(env).catch((e) => e);
    expect(err).toBeInstanceOf(StoryError);
    expect(err.message).toContain("Distributor's buy did not succeed");
    expect(err.message).toContain("The story stops here");
    expect(sent).toHaveLength(3);
  });

  it("gives up on a transaction that never finishes", async () => {
    const { env } = setup({ neverFinish: true });
    env.stepTimeoutMs = 30;
    await expect(playStory(env)).rejects.toThrow(/did not finish in time/);
  });
});
