import { create } from "zustand";
import { safeStorage } from "@/lib/safeStorage";

export type ThemeChoice = "system" | "light" | "dark";
export type DockTab = "pipeline" | "mempool" | "activity";

const KEY = "ledger-lab.ui.v1";

interface Persisted {
  theme: ThemeChoice;
  actionsOpen: boolean;
  explainOpen: boolean;
  dockOpen: boolean;
  dockTab: DockTab;
}

const DEFAULTS: Persisted = { theme: "system", actionsOpen: true, explainOpen: true, dockOpen: true, dockTab: "pipeline" };

function load(): Persisted {
  try {
    const raw = safeStorage.get(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      theme: ["system", "light", "dark"].includes(parsed.theme as string) ? (parsed.theme as ThemeChoice) : DEFAULTS.theme,
      actionsOpen: parsed.actionsOpen ?? DEFAULTS.actionsOpen,
      explainOpen: parsed.explainOpen ?? DEFAULTS.explainOpen,
      dockOpen: parsed.dockOpen ?? DEFAULTS.dockOpen,
      dockTab: ["pipeline", "mempool", "activity"].includes(parsed.dockTab as string) ? (parsed.dockTab as DockTab) : DEFAULTS.dockTab,
    };
  } catch {
    return DEFAULTS;
  }
}

interface UiState extends Persisted {
  setTheme(theme: ThemeChoice): void;
  toggleActions(): void;
  toggleExplain(): void;
  toggleDock(): void;
  setDockTab(tab: DockTab): void;
  /** Test helper: back to defaults without touching storage. */
  reset(): void;
}

export const useUi = create<UiState>((set, get) => {
  const save = () => {
    const { theme, actionsOpen, explainOpen, dockOpen, dockTab } = get();
    safeStorage.set(KEY, JSON.stringify({ theme, actionsOpen, explainOpen, dockOpen, dockTab }));
  };
  const update = (patch: Partial<Persisted>) => {
    set(patch);
    save();
  };
  return {
    ...load(),
    setTheme: (theme) => update({ theme }),
    toggleActions: () => update({ actionsOpen: !get().actionsOpen }),
    toggleExplain: () => update({ explainOpen: !get().explainOpen }),
    toggleDock: () => update({ dockOpen: !get().dockOpen }),
    setDockTab: (dockTab) => update({ dockTab, dockOpen: true }),
    reset: () => set(DEFAULTS),
  };
});
