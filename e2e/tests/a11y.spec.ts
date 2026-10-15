import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { open } from "./helpers";

const PAGES = [
  ["Explorer", "/"],
  ["Playground", "/playground"],
  ["Storage", "/storage"],
  ["Tamper Lab", "/tamper"],
  ["Learn", "/learn"],
] as const;

for (const theme of ["Light", "Dark"] as const) {
  for (const [name, path] of PAGES) {
    test(`${name} has no detectable accessibility violations (${theme} theme)`, async ({ page }) => {
      await open(page, path);
      await page.getByRole("combobox", { name: "Theme" }).selectOption({ label: theme });
      const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const summary = result.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
      expect(summary).toEqual([]);
    });
  }
}

test("everything important can be reached with the keyboard alone", async ({ page }) => {
  await open(page, "/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  const chain = page.getByRole("group", { name: "Ledger chain" });
  const first = chain.getByRole("button", { name: /^Record \d+:/ }).first();
  await first.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: /^Record #\d+/ }).first()).toBeVisible();
});
