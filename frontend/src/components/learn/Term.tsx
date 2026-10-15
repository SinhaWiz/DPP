import { Tooltip } from "@/components/common/Tooltip";
import { parseRich, termById } from "@/lib/glossary";

/** A word with a dotted underline that explains itself on hover or focus. */
export function Term({ id, children }: { id: string; children?: React.ReactNode }) {
  const entry = termById(id);
  if (!entry) return <>{children ?? id}</>;
  return (
    <Tooltip content={<div className="max-w-xs"><p className="font-medium">{entry.term}</p><p className="text-sm">{entry.short}</p></div>}>
      <span tabIndex={0} className="cursor-help underline decoration-dotted underline-offset-2" aria-label={`${children ?? entry.term}: ${entry.short}`}>
        {children ?? entry.term}
      </span>
    </Tooltip>
  );
}

/** Text in which `[[id]]` markers become glossary terms. */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {parseRich(text).map((p, i) =>
        p.kind === "term" ? <Term key={i} id={p.entry!.id}>{p.text}</Term> : <span key={i}>{p.text}</span>,
      )}
    </>
  );
}
