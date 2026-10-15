import { expect, test } from "@playwright/test";
import { open } from "./helpers";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

for (const path of ["/", "/playground", "/storage", "/tamper", "/learn"]) {
  test(`${path} fits a phone screen without sideways scrolling`, async ({ page }) => {
    await open(page, path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
}
