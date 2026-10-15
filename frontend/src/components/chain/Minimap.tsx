import { useMemo } from "react";
import type { RecordCheck, VerificationStatus } from "@dpp/shared";

const COLOR: Record<VerificationStatus, string> = {
  intact: "bg-intact",
  dataTampered: "bg-tampered",
  linkBroken: "bg-tampered",
  anchorMismatch: "bg-anchor",
};
const SEVERITY: VerificationStatus[] = ["intact", "anchorMismatch", "linkBroken", "dataTampered"];

/** The whole ledger in one thin bar: every problem is visible at a glance, even in a long chain. */
export function Minimap({ checks, onJump, visible, maxCells = 120 }: {
  checks: RecordCheck[];
  onJump(index: number): void;
  /** First and last record currently on screen. */
  visible?: [number, number];
  maxCells?: number;
}) {
  const cells = useMemo(() => {
    const size = Math.max(1, Math.ceil(checks.length / maxCells));
    const out: { from: number; to: number; status: VerificationStatus }[] = [];
    for (let i = 0; i < checks.length; i += size) {
      const slice = checks.slice(i, i + size);
      const worst = slice.reduce<VerificationStatus>((w, c) => (SEVERITY.indexOf(c.status) > SEVERITY.indexOf(w) ? c.status : w), "intact");
      out.push({ from: i, to: i + slice.length - 1, status: worst });
    }
    return out;
  }, [checks, maxCells]);

  if (checks.length === 0) return null;
  const bad = checks.filter((c) => c.status !== "intact").length;

  return (
    <div
      role="group"
      aria-label={`Overview of ${checks.length} records, ${bad === 0 ? "all intact" : `${bad} with problems`}`}
      className="flex h-3 w-full overflow-hidden rounded-full border border-border"
    >
      {cells.map((c) => {
        const inView = visible && c.to >= visible[0] && c.from <= visible[1];
        return (
          <button
            key={c.from}
            type="button"
            tabIndex={-1}
            data-status={c.status}
            data-from={c.from}
            title={c.from === c.to ? `Record #${c.from}` : `Records #${c.from}–#${c.to}`}
            onClick={() => onJump(c.from)}
            className={`h-full flex-1 ${COLOR[c.status]} ${c.status === "intact" ? "opacity-50" : ""} ${inView ? "outline outline-2 -outline-offset-2 outline-accent" : ""}`}
          />
        );
      })}
    </div>
  );
}
