import { Contract, parseEther, type InterfaceAbi, type JsonRpcSigner } from "ethers";
import type { Deployment } from "@dpp/shared";
import type { Lab } from "./lab";
import { LabError } from "./lab";

export interface ScenarioInfo {
  name: string;
  title: string;
  description: string;
  /** Needs the chain to mine on its own. */
  needsAutomine: true;
}

export const SCENARIOS: ScenarioInfo[] = [
  { name: "supplyChain", title: "Supply chain", description: "A laptop travels from manufacturer to customer through three instant sales.", needsAutomine: true },
  { name: "escrowRevocations", title: "Escrow outcomes", description: "Reservations that are confirmed, cancelled by the buyer, rejected by the seller and expired.", needsAutomine: true },
  { name: "everyError", title: "Every error", description: "One deliberately failing transaction for each custom error. They are mined, cost gas and record nothing.", needsAutomine: true },
  { name: "bulk", title: "Bulk", description: "Registers and lists N products, for performance tests.", needsAutomine: true },
];

interface Ctx {
  market: Contract;
  rejecter: Contract;
  s: JsonRpcSigner[];
  say: (step: string) => void;
  lab: Lab;
}

const eth = (v: string) => parseEther(v);
const FORCE = { gasLimit: 400_000 };

const as = (c: Ctx, signer: JsonRpcSigner) => c.market.connect(signer) as Contract;
const nextId = async (c: Ctx) => (await c.market.getFunction("productCount")()) + 1n;
const done = async (tx: Promise<{ wait: () => Promise<unknown> }>) => (await tx).wait();

/** Sends a transaction expected to fail; a revert is mined (on a DEV_NODE) and must not throw out of the scenario. */
async function attempt(c: Ctx, label: string, send: () => Promise<{ hash: string; wait: () => Promise<unknown> }>) {
  let hash: string | null = null;
  try {
    const tx = await send();
    hash = tx.hash;
    await tx.wait();
    c.say(`✔ ${label}`);
  } catch {
    c.say(`✘ ${label}${hash ? " (mined, status 0)" : " (rejected before mining)"}`);
  }
  return hash;
}

const runners: Record<string, (c: Ctx, options: Record<string, unknown>) => Promise<Record<string, unknown>>> = {
  async supplyChain(c) {
    const [manufacturer, distributor, retailer, customer] = c.s as [JsonRpcSigner, JsonRpcSigner, JsonRpcSigner, JsonRpcSigner];
    const productId = await nextId(c);
    c.say(`Manufacturer registers 'Laptop' (#${productId})`);
    await done(as(c, manufacturer).getFunction("registerProduct")("Laptop"));
    const hops: [JsonRpcSigner, string, JsonRpcSigner, string, string][] = [
      [manufacturer, "Manufacturer", distributor, "Distributor", "1.0"],
      [distributor, "Distributor", retailer, "Retailer", "1.5"],
      [retailer, "Retailer", customer, "Customer", "2.0"],
    ];
    for (const [seller, from, buyer, to, price] of hops) {
      c.say(`${from} lists for ${price} ETH, ${to} buys`);
      await done(as(c, seller).getFunction("listForSale")(productId, eth(price)));
      await done(as(c, buyer).getFunction("buy")(productId, { value: eth(price) }));
    }
    return { productId: productId.toString() };
  },

  async escrowRevocations(c) {
    const [manufacturer, distributor, retailer, customer, outsider] = c.s as JsonRpcSigner[] as [JsonRpcSigner, JsonRpcSigner, JsonRpcSigner, JsonRpcSigner, JsonRpcSigner];
    const out: Record<string, string> = {};

    out.phone = String(await nextId(c));
    c.say(`Phone (#${out.phone}): list → delist → relist → reserve → buyer revokes → reserve → confirm`);
    const phone = BigInt(out.phone);
    await done(as(c, manufacturer).getFunction("registerProduct")("Phone"));
    await done(as(c, manufacturer).getFunction("listForSale")(phone, eth("2")));
    await done(as(c, manufacturer).getFunction("cancelListing")(phone));
    await done(as(c, manufacturer).getFunction("listForSale")(phone, eth("2")));
    await done(as(c, distributor).getFunction("reserve")(phone, { value: eth("2") }));
    await done(as(c, distributor).getFunction("revokeReservation")(phone));
    await done(as(c, retailer).getFunction("reserve")(phone, { value: eth("2") }));
    await done(as(c, manufacturer).getFunction("confirmSale")(phone));

    out.tablet = String(await nextId(c));
    c.say(`Tablet (#${out.tablet}): reserve → seller rejects`);
    const tablet = BigInt(out.tablet);
    await done(as(c, manufacturer).getFunction("registerProduct")("Tablet"));
    await done(as(c, manufacturer).getFunction("listForSale")(tablet, eth("1.2")));
    await done(as(c, customer).getFunction("reserve")(tablet, { value: eth("1.2") }));
    await done(as(c, manufacturer).getFunction("rejectReservation")(tablet));

    out.watch = String(await nextId(c));
    c.say(`Watch (#${out.watch}): reserve → one day passes → anyone expires it`);
    const watch = BigInt(out.watch);
    await done(as(c, manufacturer).getFunction("registerProduct")("Watch"));
    await done(as(c, manufacturer).getFunction("listForSale")(watch, eth("0.5")));
    await done(as(c, customer).getFunction("reserve")(watch, { value: eth("0.5") }));
    await c.lab.increaseTime(Number(await c.market.getFunction("RESERVATION_PERIOD")()) + 1);
    await done(as(c, outsider).getFunction("expireReservation")(watch));

    c.say("Seller and refunded buyers withdraw");
    for (const who of [manufacturer, distributor, customer]) await done(as(c, who).getFunction("withdraw")());
    return out;
  },

  async everyError(c) {
    const [manufacturer, distributor, retailer, customer, outsider] = c.s as JsonRpcSigner[] as [JsonRpcSigner, JsonRpcSigner, JsonRpcSigner, JsonRpcSigner, JsonRpcSigner];
    const m = (s: JsonRpcSigner, fn: string) => as(c, s).getFunction(fn);
    const hashes: (string | null)[] = [];
    const fail = async (label: string, send: () => Promise<{ hash: string; wait: () => Promise<unknown> }>) => hashes.push(await attempt(c, label, send));

    const own = await nextId(c);
    await done(m(manufacturer, "registerProduct")("Error demo: listed"));
    await done(m(manufacturer, "listForSale")(own, eth("1")));
    const unlisted = await nextId(c);
    await done(m(manufacturer, "registerProduct")("Error demo: unlisted"));

    c.say("Sending deliberately failing transactions");
    await fail("EmptyName: register with an empty name", () => m(outsider, "registerProduct")("", FORCE));
    await fail("InvalidPrice: list at price 0", () => m(manufacturer, "listForSale")(unlisted, 0, FORCE));
    await fail("ProductNotFound: buy a product that doesn't exist", () => m(customer, "buy")(99999, { ...FORCE, value: eth("1") }));
    await fail("NotProductOwner: an outsider lists someone else's product", () => m(outsider, "listForSale")(unlisted, eth("1"), FORCE));
    await fail("NotListed: buy a product that isn't for sale", () => m(customer, "buy")(unlisted, { ...FORCE, value: eth("1") }));
    await fail("CannotBuyOwnProduct: the owner buys their own product", () => m(manufacturer, "buy")(own, { ...FORCE, value: eth("1") }));
    await fail("IncorrectPayment: pay 0.5 ETH for a 1 ETH product", () => m(customer, "buy")(own, { ...FORCE, value: eth("0.5") }));

    const marketAddress = await c.market.getAddress();
    const rejecterProduct = await nextId(c);
    await done((c.rejecter.getFunction("registerOn"))(marketAddress));
    await done(c.rejecter.getFunction("list")(marketAddress, rejecterProduct, eth("1")));
    await fail("PaymentFailed: the seller is a contract that refuses ETH", () => m(customer, "buy")(rejecterProduct, { ...FORCE, value: eth("1") }));

    await done(m(distributor, "reserve")(own, { value: eth("1") }));
    await fail("ProductReserved: list a product that is reserved", () => m(manufacturer, "listForSale")(own, eth("2"), FORCE));
    await fail("NotReservationBuyer: someone else revokes the reservation", () => m(retailer, "revokeReservation")(own, FORCE));
    await fail("ReservationNotExpired: expire a reservation too early", () => m(outsider, "expireReservation")(own, FORCE));
    await fail("NotReserved: confirm a product nobody reserved", () => m(manufacturer, "confirmSale")(unlisted, FORCE));
    await fail("NothingToWithdraw: withdraw with no balance", () => m(outsider, "withdraw")(FORCE));
    await done(m(distributor, "revokeReservation")(own));

    const late = await nextId(c);
    await done(m(manufacturer, "registerProduct")("Error demo: answered too late"));
    await done(m(manufacturer, "listForSale")(late, eth("1")));
    await done(m(customer, "reserve")(late, { value: eth("1") }));
    await c.lab.increaseTime(Number(await c.market.getFunction("RESERVATION_PERIOD")()) + 1);
    await fail("ReservationExpired: the seller confirms after the period", () => m(manufacturer, "confirmSale")(late, FORCE));
    await done(m(outsider, "expireReservation")(late));

    const forRejecter = await nextId(c);
    await done(m(manufacturer, "registerProduct")("Error demo: for the rejecter"));
    await done(m(manufacturer, "listForSale")(forRejecter, eth("1")));
    await done(c.rejecter.getFunction("reserveOn")(marketAddress, forRejecter, { value: eth("1") }));
    await done(m(manufacturer, "rejectReservation")(forRejecter));
    await fail("WithdrawFailed: a contract that refuses ETH tries to withdraw", () => c.rejecter.getFunction("withdrawFrom")(marketAddress, FORCE));

    return { attempts: hashes.length, mined: hashes.filter(Boolean).length };
  },

  async bulk(c, options) {
    const count = Number(options.count ?? 25);
    if (!Number.isInteger(count) || count < 1 || count > 200) throw new LabError(400, "bad_request", "count must be between 1 and 200");
    const manufacturer = c.s[0]!;
    c.say(`Creating ${count} products`);
    for (let i = 0; i < count; i++) {
      const id = await nextId(c);
      await done(as(c, manufacturer).getFunction("registerProduct")(`Item ${id}`));
      await done(as(c, manufacturer).getFunction("listForSale")(id, eth("0.01")));
    }
    return { count, records: count * 2 };
  },
};

export class ScenarioRunner {
  private running: string | null = null;

  constructor(private readonly lab: Lab) {}

  list(): ScenarioInfo[] {
    return SCENARIOS;
  }

  async run(name: string, options: Record<string, unknown> = {}): Promise<{ name: string; steps: string[]; result: Record<string, unknown> }> {
    const runner = runners[name];
    if (!runner) throw new LabError(404, "not_found", `Unknown scenario '${name}'. Known: ${SCENARIOS.map((s) => s.name).join(", ")}`);
    if (this.running) throw new LabError(409, "busy", `The scenario '${this.running}' is still running`);
    this.running = name; // claim it before any await, so a second request cannot slip in

    try {
      const deployment = this.lab.d.indexer.getDeployment();
      if (!deployment) throw new LabError(409, "no_deployment", "No contract is deployed yet");
      if (!(await this.lab.mining()).automine) {
        throw new LabError(409, "needs_automine", "Scenarios wait for each transaction to be mined. Switch mining back to automatic first.");
      }
      return await this.execute(name, runner, options, deployment);
    } finally {
      this.running = null;
    }
  }

  private async execute(
    name: string,
    runner: (c: Ctx, options: Record<string, unknown>) => Promise<Record<string, unknown>>,
    options: Record<string, unknown>,
    deployment: Deployment,
  ): Promise<{ name: string; steps: string[]; result: Record<string, unknown> }> {
    const steps: string[] = [];
    const c = await this.context(deployment, (step) => {
      steps.push(step);
      this.lab.d.bus.publish("lab.scenario", { name, step, done: false });
    });
    const result = await runner(c, options);
    await this.lab.settle();
    this.lab.d.bus.publish("lab.scenario", { name, step: "done", done: true });
    return { name, steps, result };
  }

  private async context(deployment: Deployment, say: (s: string) => void): Promise<Ctx> {
    const provider = this.lab.d.rpc.provider;
    const signers = await Promise.all([0, 1, 2, 3, 4].map((i) => provider.getSigner(i)));
    return {
      market: new Contract(deployment.contracts.market.address, deployment.contracts.market.abi as InterfaceAbi, provider),
      rejecter: new Contract(deployment.contracts.rejecter.address, deployment.contracts.rejecter.abi as InterfaceAbi, signers[0]),
      s: signers,
      say,
      lab: this.lab,
    };
  }
}
