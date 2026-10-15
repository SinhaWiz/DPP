import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Action, ErrorSchema } from "@dpp/shared";
import { startHarness, eth, type Harness } from "./helpers";

interface Result {
  groupId: string;
  mode: string;
  writes: { recordIndex: string; field: string; slot: string; oldValue: string; newValue: string }[];
  changed: string[];
  offChain: { valid: boolean; firstBrokenAt: string | null; firstBrokenOnChainAt: string | null; brokenIndexes: string[] };
  onChain: { valid: boolean; brokenAt: string } | null;
  comparison: { agree: boolean; contractFooled: boolean; notes: string[] } | null;
}

describe("lab: tampering with contract storage", () => {
  let h: Harness;
  const tamper = (body: object) => h.post<Result>("/api/lab/tamper", body);
  const undo = (id: string) => h.post<Result>(`/api/lab/tamper/${id}/undo`);

  beforeAll(async () => {
    h = await startHarness();
    await h.call(0, "registerProduct", "Laptop");            // 0
    await h.call(0, "listForSale", 1, eth("1"));              // 1
    await h.call(1, "buy", 1, { value: eth("1") });           // 2
    await h.call(1, "listForSale", 1, eth("2"));              // 3
    await h.call(1, "cancelListing", 1);                      // 4
    await h.indexer.syncOnce();
  }, 90_000);
  afterAll(async () => { await h.stop(); });

  // every test starts from an untouched chain
  beforeEach(async () => {
    if (h.repo.activeTamperGroups().length) await h.post("/api/lab/tamper/undo-all");
    expect(h.verification.summary().valid).toBe(true);
  });

  it("level 1 (data): flags only the edited record; the contract and the engine agree", async () => {
    const { status, body } = await tamper({ index: 2, field: "price", value: "999", mode: "data" });
    expect(status).toBe(200);
    expect(body.writes).toHaveLength(1);
    expect(body.changed).toEqual(["2"]);
    expect(body.offChain).toMatchObject({ valid: false, firstBrokenAt: "2", brokenIndexes: ["2"] });
    expect(body.onChain).toEqual({ valid: false, brokenAt: "2" });
    expect(body.comparison).toMatchObject({ agree: true, contractFooled: false });
    expect(h.verification.get().checks[2]!.status).toBe("dataTampered");
    expect(h.verification.get().checks[3]!.status).toBe("intact"); // the next link still points at the stored hash
  });

  it("level 2 (data + hash): the contract sees the NEXT link break, the log also exposes the forged record", async () => {
    const { body } = await tamper({ index: 2, field: "price", value: "999", mode: "data+hash" });
    expect(body.writes.map((w) => w.field)).toEqual(["price", "hash"]);
    expect(body.onChain).toEqual({ valid: false, brokenAt: "3" });
    expect(body.offChain).toMatchObject({ firstBrokenOnChainAt: "3", firstBrokenAt: "2", brokenIndexes: ["2", "3"] });
    const checks = h.verification.get().checks;
    expect(checks[2]).toMatchObject({ onChainStatus: "intact", status: "anchorMismatch" });
    expect(checks[3]).toMatchObject({ onChainStatus: "linkBroken", status: "linkBroken" });
  });

  it("level 3 (rewrite the tail): the contract is fooled, only the event log catches it", async () => {
    const { body } = await tamper({ index: 2, field: "price", value: "999", mode: "rewrite-tail" });
    expect(body.onChain).toEqual({ valid: true, brokenAt: "0" });
    expect(body.offChain).toMatchObject({ valid: false, firstBrokenAt: "2", firstBrokenOnChainAt: null, brokenIndexes: ["2", "3", "4"] });
    expect(body.comparison).toMatchObject({ agree: true, contractFooled: true });
    expect(body.changed).toEqual(["2", "3", "4"]);
    // price edit + three hashes + two prevHash links
    expect(body.writes.map((w) => `${w.recordIndex}:${w.field}`)).toEqual(["2:price", "2:hash", "3:prevHash", "3:hash", "4:prevHash", "4:hash"]);
    expect(h.verification.get().checks.slice(2).every((c) => c.status === "anchorMismatch")).toBe(true);
  });

  it("rewriting from the last record touches only that record", async () => {
    const { body } = await tamper({ index: 4, field: "price", value: "5", mode: "rewrite-tail" });
    expect(body.writes.map((w) => w.field)).toEqual(["price", "hash"]);
    expect(body.onChain!.valid).toBe(true);
    expect(body.offChain.brokenIndexes).toEqual(["4"]);
  });

  it("edits one half of the packed action+actor slot without disturbing the other", async () => {
    const before = h.repo.getRecord(2)!;
    const { body } = await tamper({ index: 2, field: "action", value: Action.Delisted, mode: "data" });
    expect(body.writes).toHaveLength(1);
    const after = h.repo.getRecord(2)!;
    expect(after.action).toBe(Action.Delisted);
    expect(after.actor).toBe(before.actor);

    await tamper({ index: 2, field: "actor", value: h.deployment.roles[4]!.address, mode: "data" });
    const final = h.repo.getRecord(2)!;
    expect(final.actor.toLowerCase()).toBe(h.deployment.roles[4]!.address.toLowerCase());
    expect(final.action).toBe(Action.Delisted); // still the edited action
  });

  it("accepts decimal and hex values, and a forged hash directly", async () => {
    await tamper({ index: 1, field: "price", value: "0x10", mode: "data" });
    expect(h.repo.getRecord(1)!.price).toBe(16n);
    const forged = "0x" + "ab".repeat(32);
    await tamper({ index: 1, field: "hash", value: forged, mode: "data" });
    expect(h.repo.getRecord(1)!.hash).toBe(forged);
    expect(h.verification.get().checks[2]!.linkOk).toBe(false); // record 2 still points at the real hash of 1
  });

  describe("undo", () => {
    it("restores exactly what was there and marks the attack undone", async () => {
      const original = { ...h.repo.getRecord(2)! };
      const { body } = await tamper({ index: 2, field: "price", value: "999", mode: "rewrite-tail" });
      const res = await undo(body.groupId);
      expect(res.status).toBe(200);
      expect(res.body.offChain).toMatchObject({ valid: true, brokenIndexes: [] });
      expect(res.body.onChain).toEqual({ valid: true, brokenAt: "0" });
      expect(h.repo.getRecord(2)).toEqual(original);
      expect(h.repo.activeTamperGroups()).toEqual([]);
      expect(h.repo.tamperGroup(body.groupId).every((r) => r.undoneAt !== null)).toBe(true);
    });

    it("cannot be undone twice, and unknown ids are 404", async () => {
      const { body } = await tamper({ index: 1, field: "price", value: "7", mode: "data" });
      await undo(body.groupId);
      const again = await undo(body.groupId);
      expect(again.status).toBe(409);
      expect(ErrorSchema.parse(again.body).error.code).toBe("already_undone");
      expect((await undo("no-such-attack")).status).toBe(404);
    });

    it("must happen newest-first when two attacks touched the same data", async () => {
      const a = (await tamper({ index: 2, field: "price", value: "111", mode: "data" })).body;
      const b = (await tamper({ index: 2, field: "price", value: "222", mode: "data" })).body;
      const early = await undo(a.groupId);
      expect(early.status).toBe(409);
      expect(ErrorSchema.parse(early.body).error.code).toBe("undo_later_first");
      expect(h.repo.getRecord(2)!.price).toBe(222n); // untouched by the refused undo

      expect((await undo(b.groupId)).status).toBe(200);
      expect(h.repo.getRecord(2)!.price).toBe(111n); // back to attack A's value
      expect((await undo(a.groupId)).status).toBe(200);
      expect(h.repo.getRecord(2)!.price).toBe(eth("1"));
    });

    it("lets independent attacks be undone in any order", async () => {
      const a = (await tamper({ index: 1, field: "price", value: "1", mode: "data" })).body;
      const b = (await tamper({ index: 3, field: "price", value: "3", mode: "data" })).body;
      expect((await undo(a.groupId)).body.offChain.brokenIndexes).toEqual(["3"]);
      expect((await undo(b.groupId)).body.offChain.valid).toBe(true);
    });

    it("undo-all reverses every attack, newest first", async () => {
      await tamper({ index: 1, field: "price", value: "1", mode: "data" });
      await tamper({ index: 1, field: "price", value: "2", mode: "data+hash" });
      await tamper({ index: 3, field: "price", value: "3", mode: "rewrite-tail" });
      const res = await h.post<{ undone: string[]; offChain: Result["offChain"] }>("/api/lab/tamper/undo-all");
      expect(res.body.undone).toHaveLength(3);
      expect(res.body.offChain.valid).toBe(true);
      expect(h.repo.getRecord(1)!.price).toBe(eth("1"));
    });
  });

  it("lists active attacks with every write", async () => {
    const { body } = await tamper({ index: 2, field: "price", value: "9", mode: "data+hash" });
    const list = await h.get<{ attacks: { groupId: string; mode: string; writes: unknown[] }[] }>("/api/lab/tamper");
    expect(list.body.attacks).toHaveLength(1);
    expect(list.body.attacks[0]).toMatchObject({ groupId: body.groupId, mode: "data+hash" });
    expect(list.body.attacks[0]!.writes).toHaveLength(2);
  });

  it("publishes lab.tampered and lab.restored with the new verdict", async () => {
    const before = h.bus.lastSeq;
    const { body } = await tamper({ index: 1, field: "price", value: "5", mode: "data" });
    await undo(body.groupId);
    const msgs = h.bus.since(before)!;
    const t = msgs.find((m) => m.type === "lab.tampered")!;
    expect(t.data).toMatchObject({ groupId: body.groupId, mode: "data", changed: ["1"] });
    expect((t.data as { offChain: { valid: boolean } }).offChain.valid).toBe(false);
    const r = msgs.find((m) => m.type === "lab.restored")!;
    expect(r.data).toMatchObject({ kind: "undo", groupId: body.groupId });
    expect((r.data as { offChain: { valid: boolean } }).offChain.valid).toBe(true);
    expect(msgs.some((m) => m.type === "verification.changed")).toBe(true);
  });

  it("restoring a snapshot also forgets storage edits made after it", async () => {
    await h.post("/api/lab/snapshots", { name: "clean" });
    await tamper({ index: 2, field: "price", value: "999", mode: "rewrite-tail" });
    expect(h.verification.summary().valid).toBe(false);

    await h.post("/api/lab/restore", { name: "clean" });
    expect(h.verification.summary().valid).toBe(true);
    expect(h.repo.activeTamperGroups()).toEqual([]);
    expect((await h.get<{ attacks: unknown[] }>("/api/lab/tamper")).body.attacks).toEqual([]);
  });

  describe("validation", () => {
    it.each([
      [{ index: 99, field: "price", value: "1" }, "no record #99"],
      [{ index: 1, field: "nope", value: "1" }, "field"],
      [{ index: 1, field: "price", value: "abc" }, "valid value"],
      [{ index: 1, field: "price", value: "-5" }, "valid value"],
      [{ index: 1, field: "action", value: "300" }, "1 bytes"],
      [{ index: 1, field: "actor", value: "0x" + "ff".repeat(21) }, "20 bytes"],
      [{ index: 1, field: "hash", value: "1", mode: "data+hash" }, "choose a data field"],
      [{ index: 1, field: "prevHash", value: "1", mode: "rewrite-tail" }, "choose a data field"],
      [{ index: "x", field: "price", value: "1" }, "index"],
      [{ field: "price", value: "1" }, "index"],
    ])("rejects %j", async (body, fragment) => {
      const r = await tamper(body);
      expect(r.status).toBe(400);
      expect(ErrorSchema.parse(r.body).error.message.toLowerCase()).toContain(String(fragment).toLowerCase());
      expect(h.repo.activeTamperGroups()).toEqual([]); // nothing was written
      expect(h.verification.summary().valid).toBe(true);
    });

    it("defaults the mode to 'data'", async () => {
      const r = await tamper({ index: 1, field: "price", value: "5" });
      expect(r.body.mode).toBe("data");
    });
  });
});
