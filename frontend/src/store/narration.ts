import { create } from "zustand";
import type { Narration } from "@/lib/narration";

const MAX = 40;

interface NarrationState {
  items: Narration[];
  push(n: Narration): void;
  clear(): void;
}

/** What the explanation panel has said, newest first. */
export const useNarration = create<NarrationState>((set) => ({
  items: [],
  push: (n) => set((s) => (s.items.some((i) => i.id === n.id) ? s : { items: [n, ...s.items].slice(0, MAX) })),
  clear: () => set({ items: [] }),
}));
