import { expect, type Page } from "@playwright/test";

/** Opens a page and waits until the app is connected to the backend and has loaded the chain. */
export async function open(page: Page, path = "/") {
  await page.goto(path);
  await expect(page.getByRole("status", { name: "Backend Live" })).toBeVisible({ timeout: 30_000 });
}

/** Chooses who to act as (a built-in role). */
export async function actAs(page: Page, role: "Manufacturer" | "Distributor" | "Retailer" | "Customer" | "Outsider") {
  await page.getByLabel("Act as").selectOption({ label: role });
  await expect(page.getByLabel("Act as")).toHaveValue(/\d/);
}

export const recordCount = async (page: Page) => (await (await page.request.get("/api/session")).json()).ledgerLength as number;
