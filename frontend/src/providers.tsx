import { useEffect, useState, type ReactNode } from "react";
import { createApi } from "@/api/client";
import { RolesProvider } from "@/lib/roles";
import { LiveController, setLiveController, useLive } from "@/store/live";

function Roles({ children }: { children: ReactNode }) {
  const roles = useLive((s) => s.session?.roles ?? []);
  return <RolesProvider roles={roles}>{children}</RolesProvider>;
}

/**
 * Starts the live data layer for the whole app and makes role names available everywhere.
 * Pass `controller` to run against a fake backend (tests).
 */
export function AppProviders({ children, controller }: { children: ReactNode; controller?: LiveController }) {
  const [live] = useState(() => {
    const c = controller ?? new LiveController({ api: createApi() });
    setLiveController(c);
    return c;
  });
  useEffect(() => {
    live.start();
    return () => live.stop();
  }, [live]);
  return <Roles>{children}</Roles>;
}
