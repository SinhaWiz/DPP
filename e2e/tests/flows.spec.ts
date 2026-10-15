import { expect, test } from "@playwright/test";
import { actAs, open, recordCount } from "./helpers";

test("a registered product travels the whole pipeline and lands on the ledger", async ({ page }) => {
  await open(page, "/playground");
  const before = await recordCount(page);
  await actAs(page, "Manufacturer");

  await page.getByRole("textbox", { name: "Name" }).fill("E2E Laptop");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  const stages = page.getByRole("list", { name: "Transaction stages" });
  await expect(stages.getByRole("button", { name: "Record appended: done" })).toBeVisible({ timeout: 30_000 });
  await expect(stages.getByRole("button", { name: "Verified: done" })).toBeVisible({ timeout: 30_000 });
  expect(await recordCount(page)).toBe(before + 1);
});

test("a call that would fail is caught before sending, and sending anyway mines a revert that records nothing", async ({ page }) => {
  await open(page, "/playground");
  await actAs(page, "Outsider");
  const before = await recordCount(page);

  await page.getByRole("radio", { name: "List for sale" }).check({ force: true });
  await page.getByRole("combobox", { name: "Product" }).selectOption({ index: 1 });
  await page.getByRole("textbox", { name: "Price (ETH)" }).fill("1");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  await expect(page.getByRole("alert").filter({ hasText: "This would fail" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Send anyway" }).click();

  const stages = page.getByRole("list", { name: "Transaction stages" });
  await expect(stages.getByRole("button", { name: "Mined (reverted): failed" })).toBeVisible({ timeout: 30_000 });
  await expect(stages.getByRole("button", { name: "Nothing recorded: failed" })).toBeVisible();
  expect(await recordCount(page)).toBe(before);
});

test("step mode holds a transaction in the mempool until a block is mined", async ({ page }) => {
  await open(page, "/playground");
  await actAs(page, "Manufacturer");
  await page.getByRole("button", { name: "Step", exact: true }).click();
  try {
    await page.getByRole("textbox", { name: "Name" }).fill("Held back");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const stages = page.getByRole("list", { name: "Transaction stages" });
    await expect(stages.getByRole("button", { name: "Pending: in progress" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Mine block" }).click();
    await expect(stages.getByRole("button", { name: "Verified: done" })).toBeVisible({ timeout: 30_000 });
  } finally {
    await page.getByRole("button", { name: "Auto", exact: true }).click();
  }
});

test("tampering is detected and every attack can be undone", async ({ page }) => {
  await open(page, "/tamper");
  await page.getByRole("button", { name: "Run the attack" }).click();
  await expect(page.getByRole("heading", { name: "What happened" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("status", { name: /Backend/ })).toBeVisible();

  await page.getByRole("button", { name: "Undo all" }).click();
  await expect(page.getByText("Every attack undone.")).toBeVisible({ timeout: 30_000 });
});
