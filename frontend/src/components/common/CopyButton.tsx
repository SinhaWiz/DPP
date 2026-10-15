import { useEffect, useRef, useState } from "react";

/** Copies `value` to the clipboard and says so, visibly and to screen readers. */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1500);
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      className="inline-flex h-5 items-center rounded px-1 text-xs text-muted hover:bg-surface-2 hover:text-text"
    >
      <span aria-hidden>{state === "copied" ? "✓" : state === "failed" ? "!" : "⧉"}</span>
      <span className="sr-only" role="status">{state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : ""}</span>
    </button>
  );
}
