import { expect, test } from "@playwright/test";
import { CreateQuestResponseSchema } from "../src/contracts";

declare global {
  interface Window {
    __openquestRealtimeSockets?: Array<{
      dispatchEvent(event: Event): boolean;
      readyState: number;
      url: string;
    }>;
  }
}

async function installSocketTracking(page: import("@playwright/test").Page): Promise<void> {
  await page.addInitScript(() => {
    const sockets: Array<{
      dispatchEvent(event: Event): boolean;
      readyState: number;
      url: string;
    }> = [];
    class TrackingWebSocket extends EventTarget {
      public static readonly CLOSED = 3;
      public static readonly OPEN = 1;
      public static readonly CONNECTING = 0;
      public readonly url: string;
      public readyState = TrackingWebSocket.CONNECTING;

      public constructor(url: string | URL) {
        super();
        this.url = String(url);
        sockets.push(this);
        queueMicrotask(() => {
          if (this.readyState !== TrackingWebSocket.CONNECTING) return;
          this.readyState = TrackingWebSocket.OPEN;
          this.dispatchEvent(new Event("open"));
        });
      }

      public close(): void {
        if (this.readyState === TrackingWebSocket.CLOSED) return;
        this.readyState = TrackingWebSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close"));
      }
    }
    window.__openquestRealtimeSockets = sockets;
    Object.defineProperty(window, "WebSocket", { configurable: true, value: TrackingWebSocket });
  });
}

async function createQuest(page: import("@playwright/test").Page, title: string) {
  const response = await page.request.post("/api/quests", {
    data: {
      description: "A deterministic Quest used to prove that a stale scope snapshot never wins a route change.",
      goal: "Keep the one-page dashboard bound to the most recently selected Quest while an older snapshot is in flight.",
      title,
    },
  });
  expect(response.status()).toBe(201);
  return CreateQuestResponseSchema.parse(await response.json());
}

function changeLocation(path: string): void {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new Event("openquest:location-changed"));
}

test("queued snapshots use the newest route generation and replace the live socket scope", async ({ page }) => {
  test.setTimeout(45_000);
  await installSocketTracking(page);
  await page.goto("/");
  const questATitle = `Route generation A ${crypto.randomUUID()}`;
  const questBTitle = `Route generation B ${crypto.randomUUID()}`;
  const questA = await createQuest(page, questATitle);
  const questB = await createQuest(page, questBTitle);
  await page.evaluate(() => window.dispatchEvent(new Event("openquest:changed")));
  await expect(page.locator(".quest-row").filter({ hasText: questATitle })).toBeVisible();

  let releaseNetwork: (() => void) | undefined;
  let markNetworkHeld: (() => void) | undefined;
  const networkHeld = new Promise<void>((resolve) => {
    markNetworkHeld = resolve;
  });
  const networkReleased = new Promise<void>((resolve) => {
    releaseNetwork = resolve;
  });
  const requestedScopes: string[] = [];
  let holdNetwork = true;

  await page.route("**/api/world*", async (route) => {
    const url = new URL(route.request().url());
    const scope = url.searchParams.get("quest_slug") ?? "network";
    requestedScopes.push(scope);
    if (holdNetwork && scope === "network") {
      holdNetwork = false;
      const response = await route.fetch();
      markNetworkHeld?.();
      await networkReleased;
      await route.fulfill({ response });
      return;
    }
    await route.continue();
  });

  try {
    await page.evaluate(() => window.dispatchEvent(new Event("openquest:changed")));
    await networkHeld;
    await page.locator(".quest-row").filter({ hasText: questATitle }).click();
    releaseNetwork?.();
    await expect(page.getByRole("heading", { name: `OPENQUEST / ${questATitle}` })).toBeVisible();
    await expect.poll(() => requestedScopes.includes(questA.slug)).toBe(true);

    let releaseQuestA: (() => void) | undefined;
    let markQuestAHeld: (() => void) | undefined;
    const questAHeld = new Promise<void>((resolve) => {
      markQuestAHeld = resolve;
    });
    const questAReleased = new Promise<void>((resolve) => {
      releaseQuestA = resolve;
    });
    let holdQuestA = true;
    await page.unroute("**/api/world*");
    await page.route("**/api/world*", async (route) => {
      const url = new URL(route.request().url());
      const scope = url.searchParams.get("quest_slug") ?? "network";
      requestedScopes.push(scope);
      if (holdQuestA && scope === questA.slug) {
        holdQuestA = false;
        const response = await route.fetch();
        markQuestAHeld?.();
        await questAReleased;
        await route.fulfill({ response });
        return;
      }
      await route.continue();
    });

    await page.evaluate(() => window.dispatchEvent(new Event("openquest:changed")));
    await questAHeld;
    await page.evaluate(changeLocation, `/q/${questB.slug}`);
    releaseQuestA?.();
    await expect(page.getByRole("heading", { name: `OPENQUEST / ${questBTitle}` })).toBeVisible();
    await expect.poll(() => requestedScopes.includes(questB.slug)).toBe(true);
    await expect(page.getByRole("heading", { name: `OPENQUEST / ${questATitle}` })).toHaveCount(0);

    await expect.poll(() => page.evaluate(() => {
      const liveSockets = (window.__openquestRealtimeSockets ?? []).filter((socket) => (
        new URL(socket.url).pathname === "/api/live"
      ));
      return liveSockets.filter((socket) => socket.readyState === WebSocket.OPEN).map((socket) => socket.url);
    })).toEqual([expect.stringContaining(`quest_id=${questB.quest_id}`)]);
  } finally {
    releaseNetwork?.();
  }
});

test("a live target retries after a failed snapshot and ignores duplicate or older invalidations", async ({ page }) => {
  test.setTimeout(30_000);
  await installSocketTracking(page);
  await page.goto("/");
  await expect(page.locator(".live-indicator")).toHaveText("LIVE");
  await expect.poll(() => page.evaluate(() => (
    window.__openquestRealtimeSockets?.some((socket) => (
      new URL(socket.url).pathname === "/api/live" && socket.readyState === WebSocket.OPEN
    )) ?? false
  ))).toBe(true);

  const targetSequence = 50_000;
  let targetRefreshes = 0;
  let targetAnnounced = false;
  await page.route("**/api/world*", async (route) => {
    if (!targetAnnounced) {
      await route.continue();
      return;
    }
    targetRefreshes += 1;
    if (targetRefreshes === 1) {
      await route.abort("failed");
      return;
    }
    const response = await route.fetch();
    const snapshot = await response.json() as { freshness: { last_sequence: number } };
    snapshot.freshness.last_sequence = targetSequence;
    await route.fulfill({
      body: JSON.stringify(snapshot),
      contentType: "application/json; charset=utf-8",
      status: response.status(),
    });
  });

  targetAnnounced = true;
  const sent = await page.evaluate((sequence) => {
    const socket = (window.__openquestRealtimeSockets ?? []).find((candidate) => (
      new URL(candidate.url).pathname === "/api/live" && candidate.readyState === WebSocket.OPEN
    ));
    if (!socket) return false;
    socket.dispatchEvent(new MessageEvent("message", {
      data: JSON.stringify({ latest_sequence: sequence, type: "openquest.changed" }),
    }));
    return true;
  }, targetSequence);
  expect(sent).toBe(true);

  await expect.poll(() => targetRefreshes).toBeGreaterThanOrEqual(2);
  await expect(page.locator(".sync-stamp")).toContainText(`#${targetSequence}`);
  const settledRefreshes = targetRefreshes;

  await page.evaluate((sequence) => {
    const socket = (window.__openquestRealtimeSockets ?? []).find((candidate) => (
      new URL(candidate.url).pathname === "/api/live" && candidate.readyState === WebSocket.OPEN
    ));
    socket?.dispatchEvent(new MessageEvent("message", {
      data: JSON.stringify({ latest_sequence: sequence - 1, type: "openquest.changed" }),
    }));
    socket?.dispatchEvent(new MessageEvent("message", {
      data: JSON.stringify({ latest_sequence: sequence, type: "openquest.changed" }),
    }));
  }, targetSequence);
  await page.waitForTimeout(1_000);
  expect(targetRefreshes).toBe(settledRefreshes);
});
