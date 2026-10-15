import { useEffect, useState } from "react";
import { canAdvance, score } from "@/lib/lessons/engine";
import { LESSONS } from "@/lib/lessons";
import type { Lesson } from "@/lib/lessons/types";
import { useLessonCtx } from "@/lib/lessons/useLessonCtx";
import { getLiveController } from "@/store/live";
import { useLessons } from "@/store/lessonStore";
import { Rich } from "./Term";

/** Marks the part of the page a step is about. */
function useHighlight(selector: string | undefined, active: boolean) {
  useEffect(() => {
    if (!selector || !active) return;
    const els = [...document.querySelectorAll(selector)];
    els.forEach((e) => e.classList.add("tour-highlight"));
    return () => els.forEach((e) => e.classList.remove("tour-highlight"));
  }, [selector, active]);
}

/** The lesson in progress: its current step, the quiz, or the result. Floats over the page. */
export function LessonOverlay({ lessons = LESSONS }: { lessons?: Lesson[] }) {
  const run = useLessons((s) => s.run);
  const status = useLessons((s) => s.status);
  const lesson = run ? lessons.find((l) => l.id === run.lessonId) : undefined;
  const ctx = useLessonCtx();
  const [hint, setHint] = useState(false);
  const store = useLessons.getState;

  // Keep the current step informed about what is happening in the app.
  useEffect(() => {
    if (lesson) useLessons.getState().observe(lesson, ctx);
  }, [lesson, ctx]);
  useEffect(() => setHint(false), [run?.step, run?.phase]);

  const step = lesson && run?.phase === "steps" ? lesson.steps[run.step] : undefined;
  useHighlight(step?.target, !!step);

  if (!run || !lesson) return null;
  const s = store();

  const header = (
    <header className="flex items-center gap-2 border-b border-border px-3 py-2">
      <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{lesson.title}</h2>
      {run.phase === "steps" && <span className="text-xs text-muted">Step {run.step + 1} of {lesson.steps.length}</span>}
      <button type="button" aria-label="Close lesson" onClick={() => s.exit()} className="rounded px-1.5 text-muted hover:bg-surface-2">✕</button>
    </header>
  );

  return (
    <aside aria-label="Lesson" className="fixed inset-x-2 bottom-2 z-40 max-h-[70vh] overflow-y-auto rounded-xl border-2 border-accent bg-surface shadow-2xl sm:inset-x-auto sm:bottom-4 sm:left-4 sm:w-[24rem]">
      {header}
      <div className="p-3 text-sm">
        {run.phase === "preparing" && (
          <div role="status">
            {run.error ? (
              <>
                <p className="font-medium text-tampered">The lesson could not be set up.</p>
                <p className="mt-1">{run.error}</p>
                <button type="button" onClick={() => void s.start(lesson, { api: getLiveController().api, say: () => {} }, ctx)} className="mt-2 rounded-md border border-border px-3 py-1.5 hover:bg-surface-2">Try again</button>
              </>
            ) : (
              <p>Setting things up… {status && <span className="text-muted">{status}</span>}</p>
            )}
          </div>
        )}

        {run.phase === "steps" && step && (
          <>
            <ol className="mb-2 flex gap-1" aria-label="Progress">
              {lesson.steps.map((st, i) => (
                <li key={st.id} aria-label={`${st.title}: ${run.done[i] ? "done" : i === run.step ? "current" : "to do"}`} className={`h-1.5 flex-1 rounded-full ${run.done[i] ? "bg-intact" : i === run.step ? "bg-accent" : "bg-border"}`} />
              ))}
            </ol>
            <h3 className="font-semibold">{step.title}</h3>
            <p className="mt-1"><Rich text={step.instruction} /></p>
            {!step.readOnly && (
              <p role="status" className={`mt-2 text-xs font-medium ${run.done[run.step] ? "text-intact" : "text-muted"}`}>
                {run.done[run.step] ? "✔ Done" : "Waiting for you to do this…"}
              </p>
            )}
            {hint && step.hint && <p className="mt-2 rounded-md bg-surface-2 p-2 text-xs"><strong>Hint:</strong> <Rich text={step.hint} /></p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" disabled={run.step === 0} onClick={() => s.back(ctx)} className="rounded-md border border-border px-2.5 py-1 hover:bg-surface-2 disabled:opacity-40">Back</button>
              <button type="button" disabled={!canAdvance(run, lesson)} onClick={() => s.next(lesson, ctx)} className="rounded-md bg-accent px-3 py-1 font-medium text-on-solid disabled:opacity-40">
                {run.step + 1 === lesson.steps.length ? (lesson.quiz.length ? "To the quiz" : "Finish") : "Next"}
              </button>
              {!step.readOnly && !run.done[run.step] && (
                <>
                  {step.hint && <button type="button" onClick={() => setHint((h) => !h)} className="rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2">{hint ? "Hide hint" : "Hint"}</button>}
                  <button type="button" onClick={() => s.skip(lesson, ctx)} className="rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2">Skip this step</button>
                </>
              )}
            </div>
          </>
        )}

        {run.phase === "quiz" && <Quiz lesson={lesson} />}

        {run.phase === "finished" && <Finished lesson={lesson} onRestart={() => void s.start(lesson, { api: getLiveController().api, say: () => {} }, ctx)} />}
      </div>
    </aside>
  );
}

function Quiz({ lesson }: { lesson: Lesson }) {
  const run = useLessons((s) => s.run)!;
  const { answer, finish, back } = useLessons.getState();
  const ctx = useLessonCtx();
  const sc = score(run, lesson);
  return (
    <div className="space-y-3">
      <h3 className="font-semibold">Check what you learned</h3>
      {lesson.quiz.map((q) => {
        const chosen = run.answers[q.id];
        return (
          <fieldset key={q.id} className="space-y-1">
            <legend className="font-medium"><Rich text={q.question} /></legend>
            {q.choices.map((c, i) => {
              const answered = chosen !== undefined;
              const right = i === q.answer;
              return (
                <label key={c} className={`flex cursor-pointer items-start gap-2 rounded-md border px-2 py-1 ${answered && right ? "border-intact bg-intact/10" : answered && chosen === i ? "border-tampered bg-tampered/10" : "border-border hover:bg-surface-2"}`}>
                  <input type="radio" name={q.id} disabled={answered} checked={chosen === i} onChange={() => answer(lesson, q.id, i)} />
                  <span>{c}</span>
                </label>
              );
            })}
            {chosen !== undefined && (
              <p role="status" className={`text-xs ${chosen === q.answer ? "text-intact" : "text-tampered"}`}>
                {chosen === q.answer ? "✔ Correct. " : "✘ Not quite. "}
                <Rich text={q.explanation} />
              </p>
            )}
          </fieldset>
        );
      })}
      <div className="flex gap-2">
        <button type="button" onClick={() => back(ctx)} className="rounded-md border border-border px-2.5 py-1 hover:bg-surface-2">Back</button>
        <button type="button" disabled={!sc.complete} onClick={() => finish(lesson)} className="rounded-md bg-accent px-3 py-1 font-medium text-on-solid disabled:opacity-40">See my result</button>
      </div>
    </div>
  );
}

function Finished({ lesson, onRestart }: { lesson: Lesson; onRestart(): void }) {
  const run = useLessons((s) => s.run)!;
  const sc = score(run, lesson);
  return (
    <div className="space-y-2" role="status">
      <h3 className="font-semibold">Lesson complete 🎉</h3>
      {sc.total > 0 && <p>You answered <strong>{sc.correct} of {sc.total}</strong> correctly.</p>}
      <div className="flex gap-2">
        <button type="button" onClick={() => useLessons.getState().exit()} className="rounded-md bg-accent px-3 py-1 font-medium text-on-solid">Back to the lessons</button>
        <button type="button" onClick={onRestart} className="rounded-md border border-border px-3 py-1 hover:bg-surface-2">Do it again</button>
      </div>
    </div>
  );
}
