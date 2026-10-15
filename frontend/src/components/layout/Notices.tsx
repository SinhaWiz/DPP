import { useState } from "react";
import type { WsMessage } from "@dpp/shared";
import { computeNotices, type Notice } from "@/lib/notices";
import { useBrowserVerification } from "@/lib/useVerification";
import { getLiveController, useLive } from "@/store/live";
import { useWallet } from "@/store/wallet";

const STYLE: Record<Notice["level"], string> = {
  error: "border-tampered bg-tampered/10",
  warning: "border-pending bg-pending/10",
  info: "border-accent bg-accent/10",
};
const ICON: Record<Notice["level"], string> = { error: "✘", warning: "!", info: "i" };

/** Messages about the connection, the network and the chain's history that a learner needs to see. */
export function Notices() {
  const { link, loaded, session, lastMessage } = useLive((s) => ({ link: s.link, loaded: s.loaded, session: s.session, lastMessage: s.lastMessage }));
  const { comparison } = useBrowserVerification();
  const { chainId: walletChainId, switchNetwork } = useWallet();
  const [dismissed, setDismissed] = useState<Record<string, number | undefined>>({});
  const [lastReset, setLastReset] = useState<WsMessage | null>(null);
  const [lastRewind, setLastRewind] = useState<WsMessage | null>(null);

  // Remember the most recent reset / rewind even after later messages replace `lastMessage`.
  if (lastMessage?.type === "chain.reset" && lastMessage.seq !== lastReset?.seq) setLastReset(lastMessage);
  if (lastMessage?.type === "chain.rewound" && lastMessage.seq !== lastRewind?.seq) setLastRewind(lastMessage);

  const notices = computeNotices({ link, loaded, session, walletChainId, lastReset, lastRewind, comparison }).filter(
    (n) => !(n.dismissible && dismissed[n.id] === (n.version ?? 0)),
  );
  if (notices.length === 0) return null;

  const act = (n: Notice) => {
    if (n.action?.kind === "retry") void getLiveController().refetchAll();
    if (n.action?.kind === "switch-network" && session?.chainId != null) void switchNetwork(session.chainId);
  };

  return (
    <div className="flex flex-col gap-px" aria-label="Notices">
      {notices.map((n) => (
        <div key={n.id} role={n.level === "error" ? "alert" : "status"} className={`flex items-start gap-3 border-b px-4 py-2 ${STYLE[n.level]}`}>
          <span aria-hidden className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-current text-xs font-bold">{ICON[n.level]}</span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">{n.title}</p>
            <p className="text-sm text-muted">{n.body}</p>
          </div>
          {n.action && (
            <button type="button" onClick={() => act(n)} className="shrink-0 rounded-md border border-current px-2.5 py-1 text-sm">{n.action.label}</button>
          )}
          {n.dismissible && (
            <button
              type="button"
              aria-label={`Dismiss: ${n.title}`}
              onClick={() => setDismissed((d) => ({ ...d, [n.id]: n.version ?? 0 }))}
              className="shrink-0 rounded-md px-2 py-1 text-sm text-muted hover:bg-surface-2"
            >
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
