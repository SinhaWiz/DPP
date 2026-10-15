import { useRef, useState } from "react";
import { Rich } from "./Term";
import { useRuleEnv } from "@/components/actions/BreakRules";
import { STORY, playStory, type StoryStep } from "@/lib/story";

const SPEEDS = { slow: 3500, normal: 2200, fast: 700 } as const;

/** Plays the manufacturer-to-customer story, one captioned step at a time. */
export function StoryPlayer() {
  const env = useRuleEnv();
  const [speed, setSpeed] = useState<keyof typeof SPEEDS>("normal");
  const [current, setCurrent] = useState<{ index: number; step: StoryStep } | null>(null);
  const [state, setState] = useState<"idle" | "playing" | "done" | "stopped" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const play = async () => {
    if (!env) return;
    abort.current = new AbortController();
    setState("playing");
    setMessage(null);
    try {
      const { productId } = await playStory({
        ...env, pauseMs: SPEEDS[speed], signal: abort.current.signal,
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        onStep: (index, step) => setCurrent({ index, step }),
      });
      setState("done");
      setMessage(`The story is finished. Product #${productId} now belongs to the Customer.`);
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      setState(text === "Stopped." ? "stopped" : "error");
      setMessage(text);
    }
  };

  const playing = state === "playing";
  return (
    <section aria-label="Story" className="rounded-xl border border-border p-4">
      <h2 className="text-base font-semibold">Watch a laptop travel from manufacturer to customer</h2>
      <p className="mt-1 text-sm text-muted">
        Plays {STORY.length} real transactions in a row, as the right person each time, with a caption for every step. Open the Explorer in another tab to watch the chain grow.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" disabled={!env || !env.automine || playing} onClick={() => void play()} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-on-solid disabled:opacity-40">
          {state === "done" || state === "stopped" || state === "error" ? "Play again" : "Play the story"}
        </button>
        <button type="button" disabled={!playing} onClick={() => abort.current?.abort()} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-40">
          Stop
        </button>
        <label className="flex items-center gap-1.5 text-sm">
          <span className="text-muted">Pace</span>
          <select aria-label="Pace" value={speed} onChange={(e) => setSpeed(e.target.value as keyof typeof SPEEDS)} disabled={playing} className="rounded-md border border-border bg-surface px-2 py-1">
            <option value="slow">Slow</option><option value="normal">Normal</option><option value="fast">Fast</option>
          </select>
        </label>
      </div>
      {!env && <p className="mt-2 text-xs text-pending">Available on the local development chain once a contract is deployed.</p>}
      {env && !env.automine && <p className="mt-2 text-xs text-pending">Switch mining to Auto first.</p>}

      {current && (
        <div aria-live="polite" className="mt-3 rounded-lg bg-surface-2 p-3 text-sm">
          <p className="text-xs text-muted" aria-label="Story progress">Step {current.index + 1} of {STORY.length} · {current.step.roleName}</p>
          <p className="mt-1"><Rich text={current.step.caption} /></p>
        </div>
      )}
      {message && <p role={state === "error" ? "alert" : "status"} className={`mt-2 text-sm ${state === "error" ? "text-tampered" : state === "done" ? "text-intact" : "text-muted"}`}>{message}</p>}
    </section>
  );
}
