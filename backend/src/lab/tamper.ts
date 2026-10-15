import { randomUUID } from "node:crypto";
import {
  buildFieldWrite, compareWithContract, computeHash, MEMBER_BYTES, recordSlot, toMemberValue, word, type Comparison,
  type LedgerRecord, type RecordMember,
} from "@dpp/shared";
import type { TamperRow } from "../db/repo";
import type { Lab } from "./lab";
import { LabError } from "./lab";
import type { VerificationSummary } from "../verification";

export type TamperMode = "data" | "data+hash" | "rewrite-tail";

/** Fields that describe what happened (as opposed to the hashes that seal it). */
export const DATA_FIELDS: RecordMember[] = ["index", "timestamp", "productId", "action", "actor", "counterparty", "price"];
export const ALL_FIELDS: RecordMember[] = [...DATA_FIELDS, "prevHash", "hash"];

export interface TamperWrite {
  recordIndex: string;
  field: string;
  slot: string;
  oldValue: string;
  newValue: string;
}

export interface TamperResult {
  groupId: string;
  mode: TamperMode | "undo";
  writes: TamperWrite[];
  /** Records whose stored values changed in the index. */
  changed: string[];
  offChain: VerificationSummary;
  onChain: { valid: boolean; brokenAt: string } | null;
  comparison: Comparison | null;
}

/**
 * Edits contract storage directly (`hardhat_setStorageAt`), the way an attacker with control of the
 * node could. Each write records the slot's previous value, so the attack can be undone exactly.
 */
export class TamperEngine {
  constructor(private readonly lab: Lab) {}

  private get d() {
    return this.lab.d;
  }

  private layout() {
    const deployment = this.d.indexer.getDeployment();
    if (!deployment) throw new LabError(409, "no_deployment", "No contract is deployed yet");
    return { deployment, address: deployment.contracts.market.address, storage: deployment.storage };
  }

  /** Parses "123", "0xabc…" or a number into a bigint that fits the field. */
  private parseValue(field: RecordMember, raw: string | number): bigint {
    try {
      const v = typeof raw === "number" ? BigInt(raw) : BigInt(raw.trim());
      return toMemberValue(field, v);
    } catch {
      throw new LabError(400, "bad_request", `'${raw}' is not a valid value for ${field} (it must fit in ${MEMBER_BYTES[field]} bytes)`);
    }
  }

  private async writeField(groupId: string, mode: TamperMode, index: bigint, field: RecordMember, value: bigint, out: TamperWrite[]): Promise<void> {
    const { address, storage } = this.layout();
    const slot = recordSlot(index, field, storage);
    const current = BigInt(await this.d.rpc.send<string>("eth_getStorageAt", [address, word(slot), "latest"]));
    const w = buildFieldWrite(index, field, value, current, storage);

    this.d.repo.addTamper({
      groupId, recordIndex: index, field, slot: word(w.slot), oldValue: word(current), newValue: word(w.value), mode, createdAt: Date.now(),
    });
    await this.d.rpc.send("hardhat_setStorageAt", [address, word(w.slot), word(w.value)]);
    out.push({ recordIndex: index.toString(), field, slot: word(w.slot), oldValue: word(current), newValue: word(w.value) });
  }

  async tamper(input: { index: string | number; field: RecordMember; value: string | number; mode: TamperMode }): Promise<TamperResult> {
    const { index: rawIndex, field, mode } = input;
    if (!ALL_FIELDS.includes(field)) throw new LabError(400, "bad_request", `Unknown field '${field}'`);
    if (mode !== "data" && !DATA_FIELDS.includes(field)) {
      throw new LabError(400, "bad_request", `Mode '${mode}' fixes the hashes itself; choose a data field (${DATA_FIELDS.join(", ")})`);
    }
    const index = BigInt(rawIndex);
    const length = BigInt(await this.ledgerLength());
    if (index >= length) throw new LabError(400, "bad_request", `There is no record #${index}; the ledger has ${length}`);

    const value = this.parseValue(field, input.value);
    const groupId = randomUUID();
    const writes: TamperWrite[] = [];

    await this.writeField(groupId, mode, index, field, value, writes);

    if (mode === "data+hash") {
      const [rec] = await this.d.indexer.chainRecords(Number(index), 1);
      await this.writeField(groupId, mode, index, "hash", BigInt(computeHash(rec!)), writes);
    }

    if (mode === "rewrite-tail") {
      const tail = await this.d.indexer.chainRecords(Number(index), Number(length - index));
      let previousHash: string | null = null;
      for (const original of tail) {
        const rec: LedgerRecord = { ...original };
        if (previousHash !== null) {
          rec.prevHash = previousHash;
          await this.writeField(groupId, mode, rec.index, "prevHash", BigInt(previousHash), writes);
        }
        rec.hash = computeHash(rec);
        await this.writeField(groupId, mode, rec.index, "hash", BigInt(rec.hash), writes);
        previousHash = rec.hash;
      }
    }

    const result = await this.finish(groupId, mode, writes);
    this.d.bus.publish("lab.tampered", { groupId, mode, index: index.toString(), field, changed: result.changed, offChain: result.offChain, onChain: result.onChain });
    return result;
  }

  private async ledgerLength(): Promise<number> {
    return this.d.indexer.chainLedgerLength();
  }

  /** Re-reads storage into the index and reports what the contract and the off-chain engine now say. */
  private async finish(groupId: string, mode: TamperResult["mode"], writes: TamperWrite[]): Promise<TamperResult> {
    const changed = await this.d.indexer.rescanStorage();
    const onChain = await this.d.indexer.onChainVerdict();
    return {
      groupId, mode, writes,
      changed: changed.map(String),
      offChain: this.d.verification.summary(),
      onChain: onChain ? { valid: onChain.valid, brokenAt: onChain.brokenAt.toString() } : null,
      comparison: onChain ? compareWithContract(this.d.verification.get(), onChain) : null,
    };
  }

  // ───────────────────────── journal ─────────────────────────

  /** Active (not undone) attacks, oldest first, with every write. */
  active(): { groupId: string; mode: string; createdAt: number; writes: TamperWrite[] }[] {
    return this.d.repo.activeTamperGroups().map((groupId) => {
      const rows = this.d.repo.tamperGroup(groupId);
      return {
        groupId, mode: rows[0]!.mode, createdAt: rows[0]!.createdAt,
        writes: rows.map((r) => ({ recordIndex: r.recordIndex.toString(), field: r.field, slot: r.slot, oldValue: r.oldValue, newValue: r.newValue })),
      };
    });
  }

  /**
   * Puts every slot of the attack back to what it held before. Attacks are a stack: if a later attack
   * touched one of the same slots, undoing this one first would leave that later attack half-applied.
   */
  async undo(groupId: string): Promise<TamperResult> {
    const rows = this.d.repo.tamperGroup(groupId);
    if (rows.length === 0) throw new LabError(404, "not_found", `No attack with id ${groupId}`);
    if (rows.every((r) => r.undoneAt !== null)) throw new LabError(409, "already_undone", "That attack was already undone");

    const mySlots = new Set(rows.map((r) => r.slot));
    const lastId = Math.max(...rows.map((r) => r.id));
    for (const other of this.d.repo.activeTamperGroups()) {
      if (other === groupId) continue;
      const later = this.d.repo.tamperGroup(other).filter((r) => r.id > lastId && mySlots.has(r.slot));
      if (later.length) throw new LabError(409, "undo_later_first", "A later attack changed the same data. Undo the later attack first.");
    }

    const { address } = this.layout();
    const writes: TamperWrite[] = [];
    for (const r of [...rows].reverse()) {
      await this.d.rpc.send("hardhat_setStorageAt", [address, r.slot, r.oldValue]);
      writes.push({ recordIndex: r.recordIndex.toString(), field: r.field, slot: r.slot, oldValue: r.newValue, newValue: r.oldValue });
    }
    this.d.repo.markTamperUndone(groupId, Date.now());

    const result = await this.finish(groupId, "undo", writes);
    this.d.bus.publish("lab.restored", { kind: "undo", groupId, changed: result.changed, offChain: result.offChain, onChain: result.onChain });
    return result;
  }

  /** Undoes every active attack, newest first. */
  async undoAll(): Promise<{ undone: string[]; offChain: VerificationSummary }> {
    const groups = this.d.repo.activeTamperGroups();
    const undone: string[] = [];
    for (const groupId of [...groups].reverse()) {
      await this.undo(groupId);
      undone.push(groupId);
    }
    return { undone, offChain: this.d.verification.summary() };
  }
}

export type { TamperRow };
