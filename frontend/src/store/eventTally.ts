import { create } from "zustand";
import type { WsMessage } from "@dpp/shared";

interface Tally {
  events: Record<string, number>;
  tampers: number;
  restores: number;
  /** Tampers after which the contract's own check still said "valid" but the browser's did not. */
  fooled: number;
  record(m: WsMessage): void;
  clear(): void;
}

/** Counts live messages since the page opened, so lessons can ask "did a tamper happen?". */
export const useTally = create<Tally>((set) => ({
  events: {},
  tampers: 0,
  restores: 0,
  fooled: 0,
  record: (m) =>
    set((s) => {
      const d = (m.data ?? {}) as { onChain?: { valid?: boolean } | null; offChain?: { valid?: boolean } };
      return {
        events: { ...s.events, [m.type]: (s.events[m.type] ?? 0) + 1 },
        tampers: s.tampers + (m.type === "lab.tampered" ? 1 : 0),
        restores: s.restores + (m.type === "lab.restored" ? 1 : 0),
        fooled: s.fooled + (m.type === "lab.tampered" && d.onChain?.valid === true && d.offChain?.valid === false ? 1 : 0),
      };
    }),
  clear: () => set({ events: {}, tampers: 0, restores: 0, fooled: 0 }),
}));
