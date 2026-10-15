import { useCallback } from "react";
import { useRoles } from "@/lib/roles";
import { getTxFlow } from "@/store/flowInstance";
import { useUi } from "@/store/uiStore";
import { useWallet } from "@/store/wallet";
import { actionByFn } from "@/web3/actions";
import type { MarketFunction } from "@/web3/market";

export class ActAsError extends Error {}

/**
 * Lets a button say "do this as that account". For the built-in accounts it switches to the account
 * first; for the user's own MetaMask account it can only act as itself.
 */
export function useActAs() {
  const roles = useRoles();

  return useCallback(
    async (address: string, fn: MarketFunction, args: unknown[] = [], value?: bigint) => {
      const wallet = useWallet.getState().wallet;
      const isMe = wallet && wallet.address.toLowerCase() === address.toLowerCase();
      if (!isMe) {
        const role = roles.find((r) => r.address.toLowerCase() === address.toLowerCase() && r.index >= 0);
        if (!role) throw new ActAsError("That account is not one of the built-in roles. Switch to it in your wallet and try again.");
        await useWallet.getState().useDemo(role.index);
        if (useWallet.getState().wallet?.address.toLowerCase() !== address.toLowerCase()) {
          throw new ActAsError(useWallet.getState().error ?? `Could not switch to ${role.name}.`);
        }
      }
      const flow = getTxFlow();
      const tx = flow.draft(actionByFn(fn), { args, value });
      useUi.getState().setDockTab("pipeline");
      await flow.run(tx.id);
      return tx.id;
    },
    [roles],
  );
}
