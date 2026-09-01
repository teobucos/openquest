import { expect, test } from "@playwright/test";

test("the control center navigates scopes, filters, and inspectors without a document reload", async ({ page }) => {
  await page.goto("/");
  const navigationEntries = await page.evaluate(() => performance.getEntriesByType("navigation").length);
  const quest = page.locator(".quest-row").first();
  const questHref = await quest.getAttribute("href");
  await quest.click();
  await expect(page).toHaveURL(/\/q\/[a-z0-9-]+$/);
  await expect(page.getByRole("heading", { name: "OPENQUEST /" })).toBeVisible();
  expect(await page.evaluate(() => performance.getEntriesByType("navigation").length)).toBe(navigationEntries);

  await page.getByRole("button", { exact: true, name: "OPEN" }).click();
  await expect(page).toHaveURL(/status=open/);
  await page.locator(".work-row").first().click();
  await expect(page).toHaveURL(/challenge=/);
  await expect(page.getByRole("dialog", { name: "Challenge inspector" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog", { name: "Challenge inspector" })).toHaveCount(0);
  await page.goBack();
  await page.goBack();
  await expect(page).toHaveURL("/");
  await page.goForward();
  await expect(page).toHaveURL(questHref ?? /\/q\//);
});

test("the inspector restores direct URL state and stays inside narrow viewports", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator(".quest-row").first().click();
  await page.locator(".work-row").first().click();
  const inspectorUrl = page.url();
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Challenge inspector" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.getByRole("button", { name: "Close Challenge inspector" }).click();
  await expect(page).not.toHaveURL(inspectorUrl);
});

test("the command center has no document horizontal overflow at target viewports", async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 768, height: 1024 }, { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
});
