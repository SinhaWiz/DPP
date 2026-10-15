import { Outlet } from "react-router-dom";
import { useTheme } from "@/lib/useTheme";
import { ActionPanel } from "@/components/actions/ActionPanel";
import { MempoolTray } from "@/components/pipeline/MempoolTray";
import { TxPipeline } from "@/components/pipeline/TxPipeline";
import { MiningControl } from "./MiningControl";
import { ActionsDrawer, Dock, ExplainDrawer } from "./Panels";
import { Notices } from "./Notices";
import { AccountSwitcher, LinkStatus } from "./Status";
import { TopBar } from "./TopBar";

/** The page frame: top bar, a main area between two drawers, and the dock underneath. */
export function Shell() {
  useTheme();
  return (
    <div className="flex h-full flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-1.5 focus:text-white">
        Skip to content
      </a>
      <TopBar status={<><LinkStatus /><MiningControl /><AccountSwitcher /></>} />
      <Notices />
      <div className="flex min-h-0 flex-1">
        <ActionsDrawer>
          <ActionPanel />
        </ActionsDrawer>
        <main id="main" className="min-w-0 flex-1 overflow-auto p-4">
          <Outlet />
        </main>
        <ExplainDrawer />
      </div>
      <Dock panels={{ pipeline: <TxPipeline />, mempool: <MempoolTray /> }} />
    </div>
  );
}
