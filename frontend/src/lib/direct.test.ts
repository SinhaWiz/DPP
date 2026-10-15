import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Contract, parseEther } from "ethers";
import { buildFieldWrite, computeHash, marketAbi, recordSlot, word } from "@dpp/shared";
import { deployContracts, makeDeployment, startDevNode, type DevNode, type Deployed } from "@dpp/shared/testing";
import type { Deployment } from "@dpp/shared";
import { fetchDeployment, loadDirect } from "./direct";
import { apiToLedgerRecord } from "./verifyInBrowser";

describe("fetchDeployment", () => {
  it("returns the deployment the dev server publishes", async () => {
    const json = { chainId: 31337, sessionId: "0x" + "ab".repeat(32), deployBlock: 1, contracts: { market: { address: "0xm", abi: [] }, rejecter: { address: "0xr", abi: [] } }, storage: { variables: {}, record: { slots: 8, members: [] } }, roles: [] };
    const f = vi.fn(async () => new Response(JSON.stringify(json)));
    expect((await fetchDeployment(f as never))?.chainId).toBe(31337);
    expect(f).toHaveBeenCalledWith("/deployment.json", { cache: "no-store" });
  });

  it("returns null when there is none, or it is unreadable, or the server is down", async () => {
    expect(await fetchDeployment((async () => new Response("{}", { status: 404 })) as never)).toBeNull();
    expect(await fetchDeployment((async () => new Response("{not json")) as never)).toBeNull();
    expect(await fetchDeployment((async () => { throw new Error("down"); }) as never)).toBeNull();
    expect(await fetchDeployment((async () => new Response(JSON.stringify({ chainId: "x" }))) as never)).toBeNull();
  });
});

describe("loadDirect against a real node, with no backend", () => {
  let node: DevNode;
  let d: Deployed;
  let deployment: Deployment;
  const as = (i: number) => d.market.connect(d.signers[i]!) as Contract;

  beforeAll(async () => {
    node = await startDevNode();
    d = await deployContracts(node.provider);
    deployment = await makeDeployment(node.provider, d);
    await (await as(0).getFunction("registerProduct")("Laptop")).wait();
    await (await as(0).getFunction("listForSale")(1, parseEther("1"))).wait();
    await (await as(1).getFunction("buy")(1, { value: parseEther("1") })).wait();
    await (await as(1).getFunction("listForSale")(1, parseEther("2"))).wait();
    await (await as(2).getFunction("reserve")(1, { value: parseEther("2") })).wait();
  }, 90_000);
  afterAll(async () => { await node.stop(); });

  it("reads every record, product and reservation, and describes itself honestly", async () => {
    const snap = await loadDirect(node.url, deployment);
    expect(snap.records.map((r) => r.actionLabel)).toEqual(["Registered", "Listed", "Sold", "Listed", "Reserved"]);
    expect(snap.records[0]!.productName).toBe("Laptop");
    expect(snap.products).toHaveLength(1);
    expect(snap.products[0]).toMatchObject({ name: "Laptop", forSale: true, reservation: { buyer: deployment.roles[2]!.address } });
    expect(snap.session).toMatchObject({ chainId: 31337, ledgerLength: 5, productCount: 1, indexer: { state: "direct" }, lab: { available: false } });
    expect(snap.session.indexer.message).toContain("backend is offline");
    expect(snap.session.roles.map((r) => r.name)).toContain("Manufacturer");
  });

  it("pairs each record with the transaction that created it, from the event log", async () => {
    const snap = await loadDirect(node.url, deployment);
    for (const r of snap.records) {
      expect(r.txHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(r.blockNumber).toBeGreaterThan(0);
      expect(r.witness).toMatchObject({ hash: r.hash, prevHash: r.prevHash });
    }
  });

  it("verifies an untouched ledger as intact", async () => {
    const snap = await loadDirect(node.url, deployment);
    expect(snap.records.every((r) => r.check.status === "intact" && r.check.anchorOk === true)).toBe(true);
  });

  it("catches a data edit without any backend", async () => {
    const address = deployment.contracts.market.address;
    const slot = recordSlot(1, "price");
    const current = BigInt(await node.provider.send("eth_getStorageAt", [address, word(slot), "latest"]));
    const w = buildFieldWrite(1, "price", 999n, current);
    await node.provider.send("hardhat_setStorageAt", [address, word(w.slot), word(w.value)]);

    const snap = await loadDirect(node.url, deployment);
    expect(snap.records[1]!.check.status).toBe("dataTampered");
    expect(snap.records.filter((r) => r.check.status !== "intact")).toHaveLength(1);
    // undo
    const back = buildFieldWrite(1, "price", parseEther("1"), BigInt(await node.provider.send("eth_getStorageAt", [address, word(slot), "latest"])));
    await node.provider.send("hardhat_setStorageAt", [address, word(back.slot), word(back.value)]);
  });

  it("catches a complete, self-consistent rewrite, because the event log still holds the originals", async () => {
    const address = deployment.contracts.market.address;
    const write = async (index: number, field: "price" | "prevHash" | "hash", value: bigint) => {
      const slot = recordSlot(index, field);
      const current = BigInt(await node.provider.send("eth_getStorageAt", [address, word(slot), "latest"]));
      const w = buildFieldWrite(index, field, value, current);
      await node.provider.send("hardhat_setStorageAt", [address, word(w.slot), word(w.value)]);
    };
    const honest = (await loadDirect(node.url, deployment)).records.map(apiToLedgerRecord);
    const forged = honest.map((r) => ({ ...r }));
    forged[2]!.price += 5n;
    for (let i = 2; i < forged.length; i++) {
      if (i > 2) forged[i]!.prevHash = forged[i - 1]!.hash;
      forged[i]!.hash = computeHash(forged[i]!);
      await write(i, "price", forged[i]!.price);
      await write(i, "prevHash", BigInt(forged[i]!.prevHash));
      await write(i, "hash", BigInt(forged[i]!.hash));
    }

    // the contract itself is fooled...
    const chain = new Contract(address, marketAbi, node.provider);
    expect((await chain.getFunction("verifyLedger").staticCall())[0]).toBe(true);
    // ...but the browser, reading the log, is not
    const snap = await loadDirect(node.url, deployment);
    expect(snap.records.slice(0, 2).every((r) => r.check.status === "intact")).toBe(true);
    expect(snap.records.slice(2).every((r) => r.check.status === "anchorMismatch")).toBe(true);
  });
});
