import { expect, test } from "@playwright/test";
import { CreateChallengeResponseSchema, CreateQuestResponseSchema } from "../src/contracts";
import { installFakeWebMcp, registeredTools } from "./helpers";

test("the control center navigates scopes, filters, and inspectors without a document reload", async ({ page }) => {
  await page.goto("/");
  const navigationEntries = await page.evaluate(() => performance.getEntriesByType("navigation").length);
  const quest = page.locator(".quest-row").filter({ hasText: /[1-9] OPEN/ }).first();
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
  await expect(page.getByRole("button", { name: "Close Challenge inspector" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Challenge inspector" })).toHaveCount(0);
  await expect(page.locator(".work-row").first()).toBeFocused();
  await page.goBack();
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
  await page.locator(".quest-row").filter({ hasText: /[1-9] OPEN/ }).first().click();
  await page.locator(".work-row").first().click();
  const inspectorUrl = page.url();
  await page.reload();
  const inspector = page.getByRole("dialog", { name: "Challenge inspector" });
  await expect(inspector).toBeVisible();
  await expect(page.locator("#root")).toHaveJSProperty("inert", true);
  const lastFocusable = inspector.locator("a[href], button:not([disabled])").last();
  await expect(lastFocusable).toBeVisible();
  await page.getByRole("button", { name: "Close Challenge inspector" }).press("Shift+Tab");
  await expect(lastFocusable).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Close Challenge inspector" })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator("#root")).toHaveJSProperty("inert", false);
  await expect(page).not.toHaveURL(inspectorUrl);
});

test("the inspector's Quest link stays in the same History shell", async ({ page }) => {
  await page.goto("/");
  const navigationEntries = await page.evaluate(() => performance.getEntriesByType("navigation").length);
  await page.locator(".work-row").first().click();
  const questLink = page.getByRole("dialog", { name: "Challenge inspector" }).locator(".inspector-context a");
  const href = await questLink.getAttribute("href");
  await questLink.click();
  await expect(page).toHaveURL(href ?? /\/q\//);
  expect(await page.evaluate(() => performance.getEntriesByType("navigation").length)).toBe(navigationEntries);
});

test("a human-created Quest keeps the same document and the five registered tools", async ({ browser }) => {
  const context = await browser.newContext({
    extraHTTPHeaders: { "cf-connecting-ip": `e2e-human-create-${crypto.randomUUID()}` },
  });
  await installFakeWebMcp(context);
  const page = await context.newPage();
  try {
    await page.goto("/");
    await expect(page.getByText("WebMCP · 5 tools ready", { exact: true })).toBeVisible();
    const navigationEntries = await page.evaluate(() => performance.getEntriesByType("navigation").length);
    const initialTools = await registeredTools(page);
    expect(initialTools).toHaveLength(5);

    await page.getByText("CREATE A QUEST", { exact: true }).click();
    await page.getByLabel("Title").fill(`Human navigation ${crypto.randomUUID()}`);
    await page.getByLabel("Goal").fill("Prove that a human Quest creation changes route state without replacing the mounted application.");
    await page.getByLabel("Description").fill("This deterministic browser form fixture stays entirely public.");
    await page.getByRole("button", { name: "Create Quest" }).click();

    await expect(page).toHaveURL(/\/q\/human-navigation-[a-z0-9-]+$/);
    expect(await page.evaluate(() => performance.getEntriesByType("navigation").length)).toBe(navigationEntries);
    expect(await registeredTools(page)).toEqual(initialTools);
  } finally {
    await context.close();
  }
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

test("long public stream text, filters, and activity stay readable at target viewports", async ({ browser }) => {
  const context = await browser.newContext({
    extraHTTPHeaders: { "cf-connecting-ip": `e2e-responsive-${crypto.randomUUID()}` },
  });
  const page = await context.newPage();
  try {
    await page.goto("/");
    const questResponse = await page.request.post("/api/quests", {
      data: {
        description: "Long public dashboard fixture. ".repeat(40),
        goal: "Keep long public Control Center text usable across all required responsive viewports.",
        title: `Responsive ${"Quest ".repeat(14)}${crypto.randomUUID()}`,
      },
    });
    expect(questResponse.status()).toBe(201);
    const quest = CreateQuestResponseSchema.parse(await questResponse.json());
    const challengeTitle = `Long ${"public Challenge ".repeat(7)}${crypto.randomUUID()}`;
    const challengeResponse = await page.request.post("/api/challenges", {
      data: {
        description: "Long public Challenge context that must remain readable in the grouped work stream. ".repeat(20),
        quest_id: quest.quest_id,
        title: challengeTitle,
      },
    });
    expect(challengeResponse.status()).toBe(201);
    CreateChallengeResponseSchema.parse(await challengeResponse.json());

    for (const viewport of [
      { width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 768, height: 1024 }, { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(`/q/${quest.slug}`);
      await expect(page.getByRole("heading", { name: /OPENQUEST \// })).toBeVisible();
      await expect(page.getByRole("button", { exact: true, name: "OPEN" })).toBeVisible();
      await expect(page.locator(".work-row").filter({ hasText: challengeTitle })).toBeVisible();
      await expect(page.getByTestId("activity-list")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    }
  } finally {
    await context.close();
  }
});
