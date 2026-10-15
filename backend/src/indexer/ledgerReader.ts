import { Contract, type InterfaceAbi, type JsonRpcProvider } from "ethers";
import { toLedgerRecord, toProduct, toReservation, ZERO_ADDRESS, type Deployment, type LedgerRecord, type Product, type Reservation } from "@dpp/shared";

/** Reads contract state at the chain head. Thin typed wrappers so the indexer stays readable. */
export class LedgerReader {
  readonly contract: Contract;

  constructor(provider: JsonRpcProvider, deployment: Deployment) {
    this.contract = new Contract(deployment.contracts.market.address, deployment.contracts.market.abi as InterfaceAbi, provider);
  }

  private call<T>(fn: string, ...args: unknown[]): Promise<T> {
    return this.contract.getFunction(fn).staticCall(...args) as Promise<T>;
  }

  async ledgerLength(): Promise<number> {
    return Number(await this.call<bigint>("ledgerLength"));
  }

  async productCount(): Promise<number> {
    return Number(await this.call<bigint>("productCount"));
  }

  async records(offset: number, limit: number): Promise<LedgerRecord[]> {
    const page = await this.call<unknown[]>("getRecords", offset, limit);
    return page.map((r) => toLedgerRecord(r as never));
  }

  async product(id: number | bigint): Promise<{ product: Product; reservation: Reservation | null }> {
    const [p, r] = await Promise.all([this.call<never>("getProduct", id), this.call<never>("getReservation", id)]);
    const reservation = toReservation(r);
    return { product: toProduct(p), reservation: reservation.buyer === ZERO_ADDRESS ? null : reservation };
  }

  /** What the contract itself reports about the chain's integrity. */
  async onChainVerdict(): Promise<{ valid: boolean; brokenAt: bigint; audit: { brokenIndexes: bigint[]; reasons: number[] } }> {
    const length = await this.ledgerLength();
    const [verdict, audit] = await Promise.all([
      this.call<[boolean, bigint]>("verifyLedger"),
      length === 0 ? Promise.resolve([[], []] as [bigint[], bigint[]]) : this.call<[bigint[], bigint[]]>("auditRange", 0, length),
    ]);
    return {
      valid: verdict[0],
      brokenAt: verdict[1],
      audit: { brokenIndexes: [...audit[0]], reasons: audit[1].map(Number) },
    };
  }
}
