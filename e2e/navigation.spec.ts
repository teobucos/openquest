import { expect, test, type Page } from "@playwright/test";
import {
  CreateChallengeResponseSchema,
  CreateQuestResponseSchema,
  ObserveResponseSchema,
} from "../src/contracts";
import { installFakeWebMcp, registeredTools } from "./helpers";

async function mockDemoQuestProjection(page: Page, community: boolean): Promise<void> {
  await page.route("**/api/world*", async (route) => {
    const response = await route.fetch();
    const snapshot = ObserveResponseSchema.parse(await response.json());
    const quest = snapshot.quests[0];
    if (!quest) throw new Error("Expected a public Quest fixture.");
    await route.fulfill({
      body: JSON.stringify({
        ...snapshot,
        quests: [{ ...quest, is_demo: true, organization: community ? null : quest.organization }, ...snapshot.quests.slice(1)],
      }),
      contentType: "application/json; charset=utf-8",
      status: response.status(),
    });
  });
}

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
  await expect(inspector).toHaveJSProperty("open", true);
  await expect(page.locator("#root")).toHaveJSProperty("inert", false);
  await expect(page.getByRole("button", { name: "Close Challenge inspector" })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(inspectorUrl);
});

test("the native inspector dialog closes from its backdrop without a reload", async ({ page }) => {
  await page.goto("/");
  const navigationEntries = await page.evaluate(() => performance.getEntriesByType("navigation").length);
  const opener = page.locator(".work-row").first();
  await opener.click();
  await expect(page.getByRole("dialog", { name: "Challenge inspector" })).toBeVisible();

  // The drawer is fixed to the right; this lands on the native dialog backdrop.
  await page.mouse.click(20, 400);
  await expect(page.getByRole("dialog", { name: "Challenge inspector" })).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(await page.evaluate(() => performance.getEntriesByType("navigation").length)).toBe(navigationEntries);
});

test("unknown routes render an OpenQuest 404 without loading network state", async ({ page }) => {
  let worldReads = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/world") worldReads += 1;
  });

  await page.goto("/not-an-openquest-route");
  await expect(page.getByText("404 / OPENQUEST ROUTE NOT FOUND", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Return to the control center" })).toBeVisible();
  expect(worldReads).toBe(0);
});

test("malformed encoded Quest paths render a 404 without requesting public state", async ({ page }) => {
  let apiReads = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) apiReads += 1;
  });

  await page.goto("/q/%");
  await expect(page.getByText("404 / OPENQUEST ROUTE NOT FOUND", { exact: true })).toBeVisible();
  expect(apiReads).toBe(0);
});

test("invalid Challenge queries do not open the inspector or request Challenge detail", async ({ page }) => {
  let challengeReads = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/challenges/")) challengeReads += 1;
  });

  await page.goto("/?challenge=not%20a%20canonical%20id");
  await expect(page.getByRole("heading", { name: "OPENQUEST CONTROL CENTER" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Challenge inspector" })).toHaveCount(0);
  expect(challengeReads).toBe(0);
});

test("the agent prompt is specific to the selected scope", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".agent-instruction")).toContainText("Help with whatever is most useful.");
  await page.locator(".quest-row").first().click();
  await expect(page.locator(".agent-instruction")).toContainText("Help move this Quest forward.");
});

test("synthetic Quest provenance is explicit on Quest cards and context", async ({ page }) => {
  await mockDemoQuestProjection(page, false);
  await page.goto("/");
  const demoQuest = page.locator(".quest-row").filter({ hasText: "DEMO ·" }).first();
  await expect(demoQuest).toBeVisible();
  const demoHref = await demoQuest.getAttribute("href");
  if (!demoHref) throw new Error("Expected the demo Quest link to have a public href.");
  const demoSnapshot = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/world" && url.searchParams.get("quest_slug") === demoHref.slice("/q/".length);
  });
  await demoQuest.click();
  await demoSnapshot;
  await expect(page.locator(".scope-provenance")).toContainText("DEMO ·");
  await expect(page.locator(".quest-context-panel .panel-heading")).toContainText("DEMO");
});

test("a synthetic community Quest presents explicit demo provenance", async ({ page }) => {
  await mockDemoQuestProjection(page, true);
  await page.goto("/");
  const communityDemo = page.locator(".quest-row").first();
  await expect(communityDemo).toContainText("DEMO ·");
  const communityHref = await communityDemo.getAttribute("href");
  if (!communityHref) throw new Error("Expected the community demo Quest link to have a public href.");
  const communitySnapshot = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/world" && url.searchParams.get("quest_slug") === communityHref.slice("/q/".length);
  });
  await communityDemo.click();
  await communitySnapshot;
  await expect(page.locator(".scope-provenance")).toContainText("DEMO · COMMUNITY QUEST");
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
