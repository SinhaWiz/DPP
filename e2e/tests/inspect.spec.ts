import { expect, test } from "@playwright/test";
import { open } from "./helpers";

test("hovering a block shows its record, the transaction behind it and its checks", async ({ page }) => {
  await open(page, "/");
  const block = page.getByRole("group", { name: "Ledger chain" }).getByRole("button", { name: /^Record \d+:/ }).first();
  await block.hover();
  const tip = page.getByRole("tooltip");
  await expect(tip).toContainText("Transaction that created it");
  await expect(tip).toContainText("prevHash");
});

test("the storage explorer shows exactly what eth_getStorageAt returns for each slot", async ({ page }) => {
  await open(page, "/storage?record=0");
  const slots = page.getByRole("region", { name: "Storage slots" });
  await expect(slots.getByRole("listitem")).toHaveCount(8);
  await expect(slots.getByText(/All eight slots/)).toBeVisible();

  const market = (await (await page.request.get("/deployment.json")).json()).contracts.market.address as string;
  const items = await slots.getByRole("listitem").all();
  for (const item of items) {
    const slot = await item.locator('[title^="0x"]').first().getAttribute("title");
    expect(slot).toMatch(/^0x[0-9a-f]{64}$/i);
    const rpc = await page.request.post("/rpc", { data: { jsonrpc: "2.0", id: 1, method: "eth_getStorageAt", params: [market, slot, "latest"] } });
    const raw = (await rpc.json()).result as string;
    const digits = BigInt(raw).toString(16);
    expect((await item.textContent())!.toLowerCase()).toContain(digits);
  }
});

test("when the backend is unreachable the page falls back to a read-only view straight from the node", async ({ page }) => {
  // only the backend's own API, not the app's source files under /src/api/
  await page.route((url) => url.pathname.startsWith("/api/"), (route) => route.abort());
  await page.routeWebSocket("**/ws", (ws) => void ws.close());
  await page.goto("/");
  await expect(page.getByText("Backend offline: read-only view")).toBeVisible({ timeout: 30_000 });
  const chain = page.getByRole("group", { name: "Ledger chain" });
  await expect(chain.getByRole("button", { name: /^Record \d+:/ }).first()).toBeVisible({ timeout: 30_000 });
});
