import type { ApiStorageRecord } from "@dpp/shared";
import { Address, Hash, SlotValue } from "@/components/common/Primitives";
import { shortHash } from "@/lib/format";

/** The 32 bytes of a packed slot split into what lives where: 11 unused bytes, the 20-byte actor, the 1-byte action. */
export function PackedSlotBar({ value }: { value: string }) {
  const hex = value.replace(/^0x/, "").padStart(64, "0");
  const parts = [
    { label: "unused", bytes: 11, hex: hex.slice(0, 22), cls: "bg-surface-2 text-muted" },
    { label: "actor", bytes: 20, hex: hex.slice(22, 62), cls: "bg-registered/20" },
    { label: "action", bytes: 1, hex: hex.slice(62), cls: "bg-listed/30" },
  ];
  return (
    <div aria-label="How this slot is packed" className="mt-1 flex overflow-hidden rounded border border-border font-mono text-[10px]">
      {parts.map((p) => (
        <div key={p.label} className={`px-1 py-0.5 ${p.cls}`} style={{ flex: p.bytes }} title={`${p.label}: ${p.bytes} byte${p.bytes === 1 ? "" : "s"}`}>
          <span className="block font-sans text-[9px] uppercase tracking-wide opacity-70">{p.label} · {p.bytes}B</span>
          <span className="break-all">{p.hex}</span>
        </div>
      ))}
    </div>
  );
}

/** The eight storage slots of one record, each with the value the maths predicts and the value the node holds. */
export function SlotView({ data }: { data: ApiStorageRecord }) {
  const mismatches = data.slots.filter((s) => !s.match).length;
  return (
    <section aria-label="Storage slots" className="space-y-2">
      <p role="status" className={`text-sm ${mismatches ? "text-tampered" : "text-intact"}`}>
        {mismatches === 0
          ? "✔ All eight slots hold exactly what the layout predicts."
          : `✘ ${mismatches} slot${mismatches === 1 ? "" : "s"} differ from what the record should hold. That is what a direct edit of contract storage looks like.`}
      </p>
      <ol className="space-y-1.5">
        {data.slots.map((s) => (
          <li key={s.position} aria-label={`Slot ${s.position}${s.match ? "" : ", differs"}`} className={`rounded-lg border p-2 ${s.match ? "border-border" : "border-tampered bg-tampered/5"}`}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="font-mono text-xs text-muted">slot +{s.position}</span>
              <span className="font-mono text-xs text-muted" title={s.slot}>{shortHash(s.slot, 8, 6)}</span>
              <span className="text-sm">
                {s.members.map((m, i) => (
                  <span key={m.name}>
                    {i > 0 && <span className="text-muted"> + </span>}
                    <span className="font-medium">{m.name}</span>
                    <span className="text-muted"> ({m.bytes} byte{m.bytes === 1 ? "" : "s"})</span>
                  </span>
                ))}
              </span>
              <span className={`ml-auto text-sm font-semibold ${s.match ? "text-intact" : "text-tampered"}`} aria-hidden>{s.match ? "✔" : "✘"}</span>
            </div>

            <div className="mt-1 text-sm">
              {s.members.map((m) => (
                <span key={m.name} className="mr-3">
                  <span className="text-muted">{m.name} = </span>
                  {/^0x[0-9a-fA-F]{40}$/.test(m.decoded) ? <Address value={m.decoded} copy={false} /> : /^0x[0-9a-fA-F]{64}$/.test(m.decoded) ? <Hash value={m.decoded} label={m.name} /> : <span className="font-mono">{m.decoded}</span>}
                </span>
              ))}
            </div>

            <div className="mt-1"><SlotValue value={s.actual} /></div>
            {s.members.length > 1 && <PackedSlotBar value={s.actual} />}
            {!s.match && (
              <p className="mt-1 text-xs text-tampered">
                The node holds <code className="font-mono">{shortHash(s.actual, 10, 6)}</code> but the record should hold <code className="font-mono">{shortHash(s.expected, 10, 6)}</code>.
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** How the slot numbers are worked out, for the record on screen. */
export function SlotMaths({ data }: { data: ApiStorageRecord }) {
  const first = data.slots[0]!;
  return (
    <details className="rounded-lg border border-border p-3 text-sm">
      <summary className="cursor-pointer select-none font-medium">Where do these slot numbers come from?</summary>
      <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-muted">
        <li>
          The ledger is a dynamic array, the first variable in the contract, so it sits at <strong className="text-text">slot 0</strong>. Slot 0 itself only holds the <em>length</em>.
        </li>
        <li>
          The elements are stored elsewhere: element 0 starts at <code className="font-mono text-text">keccak256(0)</code> = <code className="break-all font-mono text-text">{data.baseSlot}</code>.
        </li>
        <li>
          Each record takes <strong className="text-text">8 slots</strong>, so record #{data.index} starts at that number + 8 × {data.index} = <code className="break-all font-mono text-text">{first.slot}</code>.
        </li>
        <li>
          Inside the record, fields follow in order. <code className="font-mono">action</code> (1 byte) and <code className="font-mono">actor</code> (20 bytes) are small enough to be <em>packed</em> into one slot, which is why the table above has 9 fields in 8 slots.
        </li>
      </ol>
    </details>
  );
}
