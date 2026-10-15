import { Link } from "react-router-dom";
import { useNarration } from "@/store/narration";
import { useUi, type ExplainMode } from "@/store/uiStore";
import { LESSON_TITLES } from "@/lib/lessonTitles";
import type { Narration } from "@/lib/narration";
import { Rich } from "./Term";

const STYLE = { info: "border-border", good: "border-intact", bad: "border-tampered" } as const;
const ICON = { info: "i", good: "✔", bad: "✘" } as const;
const COLOR = { info: "text-accent", good: "text-intact", bad: "text-tampered" } as const;

function Card({ n, mode }: { n: Narration; mode: ExplainMode }) {
  const detailed = mode === "detailed";
  return (
    <article aria-label={n.title} className={`rounded-lg border-l-4 bg-surface-2 p-3 text-sm ${STYLE[n.level]}`}>
      <h3 className="mb-1 flex items-center gap-2 font-medium">
        <span aria-hidden className={`${COLOR[n.level]} font-bold`}>{ICON[n.level]}</span>
        {n.title}
      </h3>
      <p><Rich text={n.body} /></p>
      {detailed && n.detail && <p className="mt-1.5 text-muted"><Rich text={n.detail} /></p>}
      {detailed && n.code && (
        <figure className="mt-2">
          <figcaption className="text-xs text-muted">In the contract: <code>{n.code.title}</code></figcaption>
          <pre className="mt-0.5 overflow-x-auto rounded bg-bg p-2 font-mono text-[11px] leading-snug"><code>{n.code.lines.join("\n")}</code></pre>
        </figure>
      )}
      {n.lesson && LESSON_TITLES[n.lesson] && (
        <p className="mt-1.5"><Link className="text-accent underline" to={`/learn?lesson=${n.lesson}`}>Learn more: {LESSON_TITLES[n.lesson]} →</Link></p>
      )}
    </article>
  );
}

/** Explains whatever just happened, at the level of detail the learner chose. */
export function ExplainPanel() {
  const items = useNarration((s) => s.items);
  const clear = useNarration((s) => s.clear);
  const { explainMode, setExplainMode } = useUi();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div role="radiogroup" aria-label="Level of detail" className="inline-flex overflow-hidden rounded-md border border-border text-xs">
          {(["beginner", "detailed"] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={explainMode === m} onClick={() => setExplainMode(m)} className={`px-2.5 py-1 capitalize ${explainMode === m ? "bg-accent text-white" : "hover:bg-surface-2"}`}>
              {m}
            </button>
          ))}
        </div>
        <button type="button" onClick={clear} disabled={items.length === 0} className="rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2 disabled:opacity-40">Clear</button>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted">
          <p className="font-medium text-text">Waiting for activity</p>
          <p className="mt-1">Do something on the left, or press Mine block in Step mode, and each thing that happens is explained here.</p>
          <p className="mt-1">Underlined words are explained when you hover or focus them. <strong>Detailed</strong> adds the code behind each rule.</p>
        </div>
      ) : (
        <div className="space-y-2" aria-live="polite" aria-label="Explanations">
          {items.map((n) => <Card key={n.id} n={n} mode={explainMode} />)}
        </div>
      )}
    </div>
  );
}
