import type { ReactNode } from "react";
import { useUi, type DockTab } from "@/store/uiStore";

/** Left drawer: where the user performs actions. On narrow screens it opens over the page. */
export function ActionsDrawer({ children }: { children?: ReactNode }) {
  const open = useUi((s) => s.actionsOpen);
  if (!open) return null;
  return (
    <aside
      aria-label="Actions"
      className="z-10 w-full shrink-0 overflow-y-auto border-border bg-surface p-4 max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:max-h-[70vh] max-lg:rounded-t-xl max-lg:border-t max-lg:shadow-2xl lg:w-80 lg:border-r"
    >
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Actions</h2>
      {children ?? <EmptyState title="Nothing to do yet" hint="Actions appear here once the chain is connected." />}
    </aside>
  );
}

/** Right drawer: narrates whatever just happened. */
export function ExplainDrawer({ children }: { children?: ReactNode }) {
  const open = useUi((s) => s.explainOpen);
  if (!open) return null;
  return (
    <aside
      aria-label="What's happening"
      className="z-10 w-full shrink-0 overflow-y-auto border-border bg-surface p-4 max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:max-h-[60vh] max-lg:rounded-t-xl max-lg:border-t max-lg:shadow-2xl lg:w-80 lg:border-l"
      aria-live="polite"
    >
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">What's happening</h2>
      {children ?? <EmptyState title="Waiting for activity" hint="Do something, or hover a block, and the explanation shows up here." />}
    </aside>
  );
}

const TABS: { id: DockTab; label: string }[] = [
  { id: "pipeline", label: "Transaction pipeline" },
  { id: "mempool", label: "Mempool" },
  { id: "activity", label: "Activity" },
];

/** Bottom dock: the transaction pipeline, the mempool tray and the activity feed. */
export function Dock({ panels }: { panels?: Partial<Record<DockTab, ReactNode>> }) {
  const { dockOpen, dockTab, toggleDock, setDockTab } = useUi();
  return (
    <section aria-label="Transactions" className="border-t border-border bg-surface">
      <div className="flex items-center gap-1 px-3 pt-1">
        <div className="flex items-center gap-1" role="tablist" aria-label="Transaction views">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            id={`dock-tab-${t.id}`}
            aria-selected={dockOpen && dockTab === t.id}
            aria-controls="dock-panel"
            onClick={() => setDockTab(t.id)}
            className={`rounded-t-md px-3 py-1.5 text-sm ${dockOpen && dockTab === t.id ? "border-b-2 border-accent font-medium" : "text-muted hover:text-text"}`}
          >
            {t.label}
          </button>
        ))}
        </div>
        <button
          type="button"
          aria-expanded={dockOpen}
          aria-controls="dock-panel"
          onClick={toggleDock}
          className="ml-auto rounded-md px-2 py-1 text-sm text-muted hover:bg-surface-2"
        >
          {dockOpen ? "Hide" : "Show"}
        </button>
      </div>
      {dockOpen && (
        <div id="dock-panel" role="tabpanel" aria-labelledby={`dock-tab-${dockTab}`} className="max-h-60 min-h-24 overflow-y-auto p-4">
          {panels?.[dockTab] ?? <EmptyState title="No transactions yet" hint="Transactions you send, and how far each one got, show up here." />}
        </div>
      )}
    </section>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-4 text-center">
      <p className="font-medium">{title}</p>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
    </div>
  );
}
