import { useMemo } from "react";
import { useLive } from "@/store/live";
import { compareWithServer, verifyInBrowser } from "./verifyInBrowser";

/** The browser's own verdict on the ledger, and whether it matches what the server said. */
export function useBrowserVerification() {
  const records = useLive((s) => s.records);
  return useMemo(() => {
    const result = verifyInBrowser(records);
    return { result, comparison: compareWithServer(result, records) };
  }, [records]);
}
