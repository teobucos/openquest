import { expect, test } from "@playwright/test";
import { CreateQuestResponseSchema } from "../src/contracts";
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

test("scoped navigation never renders a prior Quest while loading or after a failure", async ({ page }) => {
  await page.goto("/");
  async function createQuest(title: string) {
    const response = await page.request.post("/api/quests", {
      data: {
        description: "A route-state fixture that ensures scoped navigation never attributes stale public data to another Quest.",
        goal: "Verify loading and failure states never render the previous Quest as the current scope.",
        title,
      },
    });
    expect(response.status()).toBe(201);
    return CreateQuestResponseSchema.parse(await response.json());
  }

  const firstTitle = `First scoped route ${crypto.randomUUID()}`;
  const secondTitle = `Second scoped route ${crypto.randomUUID()}`;
  const first = await createQuest(firstTitle);
  const second = await createQuest(secondTitle);
  await page.reload();
  await expect(page.getByText(firstTitle, { exact: true })).toBeVisible();

  let releaseRequest: (() => void) | undefined;
  const heldRequest = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route("**/api/world?*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.searchParams.get("quest_slug") === first.slug) {
      await heldRequest;
    }
    await route.continue();
  });

  await page.locator(".quest-row").filter({ hasText: firstTitle }).click();
  await expect(page).toHaveURL(new RegExp(`/q/${first.slug}$`));
  await expect(page.getByText("Loading public state…", { exact: true })).toBeVisible();
  await expect(page.getByText(secondTitle, { exact: true })).toHaveCount(0);
  releaseRequest?.();
  await expect(page.getByRole("heading", { name: `OPENQUEST / ${firstTitle}` })).toBeVisible();

  await page.evaluate(() => {
    window.history.pushState(null, "", "/q/missing-scoped-quest");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.getByText("Quest not found.", { exact: true })).toBeVisible();
});

test("malformed encoded client routes remain a safe network view", async ({ page }) => {
  await page.goto("/q/%");
  await expect(page.getByRole("heading", { name: "OPENQUEST CONTROL CENTER" })).toBeVisible();
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
