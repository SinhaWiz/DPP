import { useSearchParams } from "react-router-dom";
import { Rich } from "@/components/learn/Term";
import { StoryPlayer } from "@/components/learn/StoryPlayer";
import { GLOSSARY } from "@/lib/glossary";
import { LESSONS } from "@/lib/lessons";
import type { Lesson } from "@/lib/lessons/types";
import { useLessonCtx } from "@/lib/lessons/useLessonCtx";
import { getLiveController, useLive } from "@/store/live";
import { useLessons } from "@/store/lessonStore";

function LessonCard({ lesson, highlighted, labOff, disabledReason }: { lesson: Lesson; highlighted: boolean; labOff: boolean; disabledReason: string | null }) {
  const progress = useLessons((s) => s.progress[lesson.id]);
  const running = useLessons((s) => s.run?.lessonId === lesson.id);
  const ctx = useLessonCtx();
  const blocked = lesson.needsLab && labOff;

  const start = () => void useLessons.getState().start(lesson, { api: getLiveController().api, say: () => {} }, ctx);
  return (
    <li id={`lesson-${lesson.id}`} className={`rounded-xl border p-4 ${highlighted ? "border-accent ring-2 ring-accent/40" : "border-border"}`}>
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-base font-semibold">{lesson.title}</h2>
        <span className="text-xs text-muted">{lesson.minutes} min</span>
        {lesson.needsLab && <span className="rounded-full border border-pending px-2 text-xs text-pending">needs the local lab</span>}
        {progress && <span className="ml-auto rounded-full border border-intact px-2 text-xs text-intact" aria-label={`Completed, ${progress.correct} of ${progress.total} correct`}>✔ {progress.correct}/{progress.total}</span>}
      </div>
      <p className="mt-1 text-sm text-muted"><Rich text={lesson.summary} /></p>
      <div className="mt-3 flex items-center gap-3">
        <button type="button" disabled={blocked || running} onClick={start} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
          {running ? "In progress" : progress ? "Do it again" : "Start the lesson"}
        </button>
        {blocked && <span className="text-xs text-pending">{disabledReason ?? "The lab is not available here."}</span>}
      </div>
    </li>
  );
}

export function LearnPage({ lessons = LESSONS }: { lessons?: Lesson[] }) {
  const [params] = useSearchParams();
  const wanted = params.get("lesson");
  const lab = useLive((s) => s.session?.lab ?? null);
  const progress = useLessons((s) => s.progress);
  const done = lessons.filter((l) => progress[l.id]).length;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Learn</h1>
        <p className="text-muted">Guided lessons from “what is a block?” to breaking the chain. Each one runs on the real chain, with steps you do yourself.</p>
        <p className="mt-1 text-sm" aria-label="Your progress">{done} of {lessons.length} lessons completed</p>
        {done > 0 && (
          <button type="button" onClick={() => useLessons.getState().resetProgress()} className="mt-1 text-xs text-muted underline">Reset my progress</button>
        )}
      </div>

      <StoryPlayer />

      {lessons.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">Lessons are on their way.</p>
      ) : (
        <ol className="space-y-3" aria-label="Lessons">
          {lessons.map((l) => (
            <LessonCard key={l.id} lesson={l} highlighted={wanted === l.id} labOff={!lab?.available} disabledReason={lab?.reason ?? null} />
          ))}
        </ol>
      )}

      <section aria-label="Glossary" id="glossary">
        <h2 className="text-lg font-semibold">Glossary</h2>
        <p className="mb-2 text-sm text-muted">The same words are underlined throughout the app; hover or focus one to see this.</p>
        <dl className="space-y-2">
          {GLOSSARY.map((g) => (
            <div key={g.id} className="rounded-lg border border-border p-3" id={`term-${g.id}`}>
              <dt className="font-medium">{g.term}</dt>
              <dd className="text-sm">{g.short}</dd>
              <dd className="mt-1 text-sm text-muted">{g.long}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
