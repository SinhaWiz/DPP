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

/** `**bold**` and `*italic*` inside a piece of plain text. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter((p) => p !== "");
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") && p.length > 4 ? <strong key={i}>{p.slice(2, -2)}</strong>
        : p.startsWith("*") && p.endsWith("*") && p.length > 2 ? <em key={i}>{p.slice(1, -1)}</em>
        : <span key={i}>{p}</span>,
      )}
    </>
  );
}

/** Text with `[[id]]` glossary markers, `**bold**` and `*italic*`. */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {parseRich(text).map((p, i) =>
        p.kind === "term" ? <Term key={i} id={p.entry!.id}>{p.text}</Term> : <Inline key={i} text={p.text} />,
      )}
    </>
  );
}
