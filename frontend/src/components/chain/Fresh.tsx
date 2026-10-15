import { motion } from "framer-motion";
import { usePrefersReducedMotion } from "@/lib/useReducedMotion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ApiRecord } from "@dpp/shared";

/** How long a new record is treated as "just arrived". */
export const FRESH_MS = 2200;

/**
 * Tells which records appeared since the view was first shown. The first batch (what was already on
 * the chain) is the baseline and is never animated; only later arrivals are.
 */
export function useFreshRecords(records: ApiRecord[], enabled = true, ttlMs = FRESH_MS): Set<string> {
  const baseline = useRef<number | null>(null);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  useEffect(() => {
    const timerMap = timers.current;
    return () => timerMap.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (baseline.current === null || records.length < baseline.current) {
      // first look, or the chain got shorter (reset / rewind): start over from what is there now
      baseline.current = records.length;
      timers.current.forEach(clearTimeout);
      timers.current.clear();
      setFresh(new Set());
      return;
    }
    const added = records.slice(baseline.current).map((r) => r.index);
    baseline.current = records.length;
    if (added.length === 0) return;

    setFresh((prev) => new Set([...prev, ...added]));
    for (const index of added) {
      timers.current.set(
        index,
        setTimeout(() => {
          timers.current.delete(index);
          setFresh((prev) => {
            const next = new Set(prev);
            next.delete(index);
            return next;
          });
        }, ttlMs),
      );
    }
  }, [records, enabled, ttlMs]);

  return fresh;
}

/** Slides a new block in. With reduced motion it does not move; it only flashes. */
export function FreshWrapper({ fresh, children }: { fresh: boolean; children: ReactNode }) {
  const reduce = usePrefersReducedMotion();
  if (!fresh) return <>{children}</>;
  if (reduce) {
    return <div data-fresh="true" data-motion="reduced" className="rounded-lg ring-2 ring-accent">{children}</div>;
  }
  return (
    <motion.div data-fresh="true" data-motion="full" initial={{ opacity: 0, y: -28, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 22 }}>
      {children}
    </motion.div>
  );
}

const HEX = "0123456789abcdef";

/**
 * Shows hex digits that churn and then settle on the real value, as if the hash were being worked
 * out. Only the 0x prefix and the length stay fixed. With reduced motion it shows the value at once.
 */
export function ScrambleText({ value, active, durationMs = 700, random = Math.random }: { value: string; active: boolean; durationMs?: number; random?: () => number }) {
  const reduce = usePrefersReducedMotion();
  const [text, setText] = useState(value);

  useEffect(() => {
    if (!active || reduce) {
      setText(value);
      return;
    }
    const start = Date.now();
    const tick = () => {
      const progress = Math.min(1, (Date.now() - start) / durationMs);
      const settled = Math.floor(progress * value.length);
      setText(value.split("").map((ch, i) => (i < 2 || i < settled ? ch : HEX[Math.floor(random() * 16)]!)).join(""));
      if (progress >= 1) clearInterval(id);
    };
    const id = setInterval(tick, 45);
    tick();
    return () => clearInterval(id);
  }, [value, active, reduce, durationMs, random]);

  return <>{text}</>;
}
