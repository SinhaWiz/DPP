import { expect, test } from "@playwright/test";
import { open } from "./helpers";

test("the app loads, connects to the backend and shows the seeded chain", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("heading", { level: 1, name: "Explorer" })).toBeVisible();
  const chain = page.getByRole("group", { name: "Ledger chain" });
  await expect(chain.getByRole("button", { name: /^Record \d+:/ }).first()).toBeVisible();
  await expect(page.getByRole("status", { name: "Backend Live" })).toContainText("chain 31337");
});
