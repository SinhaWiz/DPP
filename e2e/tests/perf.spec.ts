import { expect, test } from "@playwright/test";
import { open, recordCount } from "./helpers";

// Runs after the other specs (alphabetical order) because it makes the shared chain large.
test("a ledger of about 1,200 records stays quick to open, draws only what is visible and still verifies", async ({ page }) => {
  test.setTimeout(240_000);
  for (let i = 0; i < 3; i++) {
    const res = await page.request.post("/api/lab/scenarios/bulk", { data: { count: 200 }, timeout: 120_000 });
    expect(res.ok()).toBeTruthy();
  }
  expect(await recordCount(page)).toBeGreaterThanOrEqual(1200);

  const started = Date.now();
  await open(page, "/");
  const chain = page.getByRole("group", { name: "Ledger chain" });
  await expect(chain.getByRole("button", { name: /^Record \d+:/ }).first()).toBeVisible({ timeout: 30_000 });
  const openMs = Date.now() - started;
  console.log(`opened a ${await recordCount(page)}-record ledger in ${openMs} ms`);
  expect(openMs).toBeLessThan(20_000);

  // only the records near the viewport are in the page
  const drawn = await chain.getByRole("button", { name: /^Record \d+:/ }).count();
  expect(drawn).toBeLessThan(150);

  // the in-browser audit of the full ledger finishes and agrees
  await page.goto("/tamper");
  await page.getByRole("button", { name: "Full audit in your browser" }).click();
  await expect(page.getByLabel("Console result")).toContainText(/intact|valid|every record/i, { timeout: 60_000 });
});
