import { create } from "zustand";

/** Which record the user has selected in the chain (opens its detail drawer, highlights it elsewhere). */
interface SelectionState {
  selected: bigint | null;
  /** Show only this product's records at full strength; the rest are dimmed. */
  productFilter: string | null;
  select(index: bigint | null): void;
  setProductFilter(id: string | null): void;
}

export const useSelection = create<SelectionState>((set) => ({
  selected: null,
  productFilter: null,
  select: (selected) => set({ selected }),
  setProductFilter: (productFilter) => set({ productFilter }),
}));
