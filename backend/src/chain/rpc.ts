import { JsonRpcProvider } from "ethers";

const RETRYABLE = /ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed|network|socket hang up/i;

export interface Rpc {
  provider: JsonRpcProvider;
  /** Raw JSON-RPC call, with retry on connection errors. */
  send<T = unknown>(method: string, params?: unknown[]): Promise<T>;
  /** Cheap liveness check. */
  ping(): Promise<boolean>;
  destroy(): void;
}

export interface RpcOptions {
  retries?: number;
  baseDelayMs?: number;
}

/**
 * JSON-RPC client for the local node. The read cache is disabled on purpose: the lab rewrites
 * contract storage between reads, and a cached value would hide the change.
 */
export function createRpc(url: string, { retries = 4, baseDelayMs = 150 }: RpcOptions = {}): Rpc {
  const provider = new JsonRpcProvider(url, undefined, {
    staticNetwork: true,
    batchMaxCount: 1,
    cacheTimeout: -1,
  });

  async function send<T>(method: string, params: unknown[] = []): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return (await provider.send(method, params)) as T;
      } catch (e) {
        lastError = e;
        const message = e instanceof Error ? e.message : String(e);
        // Only connection problems are retried; a JSON-RPC error (e.g. method not found) is final.
        if (!RETRYABLE.test(message) || attempt === retries) break;
        await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt));
      }
    }
    throw lastError;
  }

  return {
    provider,
    send,
    ping: async () => {
      try {
        await provider.send("eth_chainId", []);
        return true;
      } catch {
        return false;
      }
    },
    destroy: () => provider.destroy(),
  };
}
