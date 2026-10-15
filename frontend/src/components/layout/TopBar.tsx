import { NavLink } from "react-router-dom";
import { useUi, type ThemeChoice } from "@/store/uiStore";

export const NAV = [
  { to: "/", label: "Explorer", end: true },
  { to: "/playground", label: "Playground" },
  { to: "/storage", label: "Storage" },
  { to: "/tamper", label: "Tamper Lab" },
  { to: "/learn", label: "Learn" },
] as const;

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function TopBar({ status }: { status?: React.ReactNode }) {
  const { theme, setTheme, actionsOpen, explainOpen, toggleActions, toggleExplain } = useUi();

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-surface px-4 py-2">
      <div className="flex items-center gap-2 font-semibold">
        <span aria-hidden className="grid h-7 w-7 place-items-center rounded-md bg-accent text-sm text-on-solid">⛓</span>
        <span>Ledger Lab</span>
      </div>

      <nav aria-label="Main" className="flex flex-wrap gap-1">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={"end" in item ? item.end : false}
            className={({ isActive }) =>
              `rounded-md px-3 py-1.5 text-sm ${isActive ? "bg-surface-2 font-medium text-text" : "text-muted hover:bg-surface-2 hover:text-text"}`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {status}
        <button
          type="button"
          aria-pressed={actionsOpen}
          onClick={toggleActions}
          className="rounded-md border border-border px-2.5 py-1 text-sm hover:bg-surface-2"
        >
          Actions
        </button>
        <button
          type="button"
          aria-pressed={explainOpen}
          onClick={toggleExplain}
          className="rounded-md border border-border px-2.5 py-1 text-sm hover:bg-surface-2"
        >
          Explain
        </button>
        <label className="flex items-center gap-1 text-sm text-muted">
          <span className="sr-only">Theme</span>
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value as ThemeChoice)}
            className="rounded-md border border-border bg-surface px-2 py-1 text-text"
            aria-label="Theme"
          >
            {THEMES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>
      </div>
    </header>
  );
}
