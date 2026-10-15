import { useMemo } from "react";
import { ChainStrip } from "@/components/chain/ChainStrip";
import { EmptyState } from "@/components/layout/Panels";
import { AttackJournal, SafetyBar, TamperBanner, useEntrySnapshot } from "@/components/tamper/Safety";
import { useBrowserVerification } from "@/lib/useVerification";
import { useAttacks } from "@/lib/useAttacks";
import { useLive } from "@/store/live";

export function TamperPage() {
  const { loaded, lab, hasContract, records } = useLive((s) => ({
    loaded: s.loaded, lab: s.session?.lab ?? null, hasContract: !!s.session?.contracts, records: s.records,
  }));
  const available = !!lab?.available && hasContract;
  const snapshot = useEntrySnapshot(available);
  const { attacks, reload } = useAttacks();
  const { result } = useBrowserVerification();
  const broken = useMemo(() => result.checks.filter((c) => c.status !== "intact").length, [result]);

  if (!loaded) {
    return (
      <div className="mx-auto max-w-2xl space-y-3">
        <h1 className="text-xl font-semibold">Tamper Lab</h1>
        <EmptyState title="Loading…" />
      </div>
    );
  }

  if (!available) {
    return (
      <div className="mx-auto max-w-2xl space-y-3">
        <h1 className="text-xl font-semibold">Tamper Lab</h1>
        <EmptyState
          title="Only available on the local development chain"
          hint={lab?.reason ?? (hasContract ? "The lab is not available here." : "Deploy the contract first (`npm run dev:deploy`).")}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-full space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Tamper Lab</h1>
        <p className="text-muted">Edit stored data on a local chain and watch each defence react.</p>
      </div>

      <TamperBanner />
      <SafetyBar attacks={attacks} snapshotReady={snapshot.ready} onChanged={reload} />
      {snapshot.error && <p role="alert" className="text-sm text-tampered">Could not take the safety snapshot: {snapshot.error}</p>}

      <section aria-label="The chain under attack">
        <p className="mb-1 text-sm" role="status">
          {broken === 0 ? <span className="text-intact">✔ Every record verifies.</span> : <span className="text-tampered">✘ {broken} record{broken === 1 ? "" : "s"} no longer verify.</span>}
        </p>
        <ChainStrip records={records} verification={result} animate={false} />
      </section>

      <AttackJournal attacks={attacks} />
    </div>
  );
}
