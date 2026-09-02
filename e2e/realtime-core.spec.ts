import { expect, test } from "@playwright/test";
import { CreateQuestResponseSchema } from "../src/contracts";

declare global {
  interface Window {
    __openquestRealtimeSockets?: Array<{
      dispatchEvent(event: Event): boolean;
      readyState: number;
      url: string;
    }>;
    __openquestStaleNetworkSnapshot?: boolean;
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
    window.__openquestStaleNetworkSnapshot = false;
    const watchForStaleNetworkSnapshot = () => {
      if (!window.location.pathname.startsWith("/q/")) return;
      const text = document.body.textContent ?? "";
      const openTotal = Array.from(document.querySelectorAll(".telemetry-cell"))
        .find((cell) => cell.textContent?.includes("Challenges accepting work"))
        ?.querySelector("strong")?.textContent;
      if (
        text.includes("NETWORK ACTIVITY SNAPSHOT")
        || text.includes("NETWORK WORK SNAPSHOT")
        || openTotal === "911"
      ) {
        window.__openquestStaleNetworkSnapshot = true;
      }
    };
    const observer = new MutationObserver(watchForStaleNetworkSnapshot);
    window.addEventListener("DOMContentLoaded", () => {
      observer.observe(document.body, { childList: true, subtree: true });
      watchForStaleNetworkSnapshot();
    }, { once: true });
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

interface ScopedSnapshot {
  activity: Array<{ summary: string }>;
  freshness: { last_sequence: number };
  totals: { open: number };
  work_stream: Array<{ challenge: { title: string } }>;
}

const networkSnapshot = {
  activity: "NETWORK ACTIVITY SNAPSHOT",
  latestSequence: 91_001,
  openTotal: 911,
  work: "NETWORK WORK SNAPSHOT",
};

function snapshotFor(scope: string): { latestSequence: number; openTotal: number } {
  if (scope === "network") return networkSnapshot;
  if (scope === "quest-a") return { latestSequence: 91_101, openTotal: 1_011 };
  return { latestSequence: 91_201, openTotal: 1_111 };
}

function stampSnapshot(snapshot: ScopedSnapshot, scope: string): ScopedSnapshot {
  const marker = snapshotFor(scope);
  snapshot.freshness.last_sequence = marker.latestSequence;
  snapshot.totals.open = marker.openTotal;
  if (scope === "network") {
    const firstWork = snapshot.work_stream[0];
    const firstActivity = snapshot.activity[0];
    if (firstWork) firstWork.challenge.title = networkSnapshot.work;
    if (firstActivity) firstActivity.summary = networkSnapshot.activity;
  }
  return snapshot;
}

async function expectScopeSnapshot(
  page: import("@playwright/test").Page,
  heading: string,
  marker: { latestSequence: number; openTotal: number },
): Promise<void> {
  await expect(page.locator("#scope-title")).toHaveText(heading);
  await expect(page.getByTestId("latest-event-indicator")).toContainText(`#${marker.latestSequence}`);
  await expect(page.locator(".telemetry-cell").filter({ hasText: "Challenges accepting work" }).locator("strong")).toHaveText(String(marker.openTotal));
}

async function expectNoNetworkSnapshot(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.getByText(networkSnapshot.work, { exact: true })).toHaveCount(0);
  await expect(page.getByText(networkSnapshot.activity, { exact: true })).toHaveCount(0);
  await expect(page.getByText(String(networkSnapshot.openTotal), { exact: true })).toHaveCount(0);
}

interface HeldSnapshot {
  readonly ready: Promise<void>;
  readonly release: () => void;
  readonly scope: string;
  markReady(): void;
  waitForRelease(): Promise<void>;
}

function holdNextSnapshot(scope: string): HeldSnapshot {
  let markReady: (() => void) | undefined;
  let release: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    markReady() {
      markReady?.();
    },
    ready,
    release() {
      release?.();
    },
    scope,
    waitForRelease() {
      return released;
    },
  };
}

test("queued snapshots keep each route scope exact and leave only the final network socket", async ({ page }) => {
  test.setTimeout(45_000);
  await installSocketTracking(page);
  let questASlug = "";
  let questBSlug = "";
  const requestedScopes: string[] = [];
  let activeRelease: (() => void) | undefined;
  let heldSnapshot: HeldSnapshot | null = null;

  await page.route("**/api/world*", async (route) => {
    const url = new URL(route.request().url());
    const scope = url.searchParams.get("quest_slug") ?? "network";
    requestedScopes.push(scope);
    const response = await route.fetch();
    const snapshotScope = scope === "network"
      ? "network"
      : scope === questASlug
        ? "quest-a"
        : scope === questBSlug
          ? "quest-b"
          : scope;
    const snapshot = stampSnapshot(await response.json() as ScopedSnapshot, snapshotScope);
    if (heldSnapshot?.scope !== scope) {
      await route.fulfill({
        body: JSON.stringify(snapshot),
        contentType: "application/json; charset=utf-8",
        status: response.status(),
      });
      return;
    }
    const snapshotHold = heldSnapshot;
    heldSnapshot = null;
    activeRelease = snapshotHold.release;
    snapshotHold.markReady();
    try {
      await snapshotHold.waitForRelease();
      await route.fulfill({
        body: JSON.stringify(snapshot),
        contentType: "application/json; charset=utf-8",
        status: response.status(),
      });
    } finally {
      activeRelease = undefined;
    }
  });

  await page.goto("/");
  await expectScopeSnapshot(page, "OPENQUEST CONTROL CENTER", networkSnapshot);
  await expect(page.getByText(networkSnapshot.work, { exact: true })).toBeVisible();
  await expect(page.getByText(networkSnapshot.activity, { exact: true })).toBeVisible();
  const questATitle = `Route generation A ${crypto.randomUUID()}`;
  const questBTitle = `Route generation B ${crypto.randomUUID()}`;
  const questA = await createQuest(page, questATitle);
  const questB = await createQuest(page, questBTitle);
  questASlug = questA.slug;
  questBSlug = questB.slug;
  await page.evaluate(() => window.dispatchEvent(new Event("openquest:changed")));
  await expect(page.locator(".quest-row").filter({ hasText: questATitle })).toBeVisible();

  try {
    const networkHold = holdNextSnapshot("network");
    heldSnapshot = networkHold;
    await page.evaluate(() => window.dispatchEvent(new Event("openquest:changed")));
    await networkHold.ready;
    await page.locator(".quest-row").filter({ hasText: questATitle }).click();
    await expect(page.locator(".loading")).toBeVisible();
    await expectNoNetworkSnapshot(page);
    networkHold.release();
    await expectScopeSnapshot(page, `OPENQUEST / ${questATitle}`, snapshotFor("quest-a"));
    await expect.poll(() => requestedScopes.includes(questA.slug)).toBe(true);

    const questAHold = holdNextSnapshot(questA.slug);
    heldSnapshot = questAHold;
    await page.evaluate(() => window.dispatchEvent(new Event("openquest:changed")));
    await questAHold.ready;
    await page.evaluate(changeLocation, `/q/${questB.slug}`);
    await expect(page.locator(".loading")).toBeVisible();
    await expectNoNetworkSnapshot(page);
    questAHold.release();
    await expectScopeSnapshot(page, `OPENQUEST / ${questBTitle}`, snapshotFor("quest-b"));
    await expect.poll(() => requestedScopes.includes(questB.slug)).toBe(true);

    const questBHold = holdNextSnapshot(questB.slug);
    heldSnapshot = questBHold;
    await page.evaluate(() => window.dispatchEvent(new Event("openquest:changed")));
    await questBHold.ready;
    await page.evaluate(changeLocation, "/");
    await expect(page.locator(".loading")).toBeVisible();
    questBHold.release();
    await expectScopeSnapshot(page, "OPENQUEST CONTROL CENTER", networkSnapshot);
    await expect.poll(() => page.evaluate(() => window.__openquestStaleNetworkSnapshot)).toBe(false);

    await expect.poll(() => page.evaluate(() => {
      const liveSockets = (window.__openquestRealtimeSockets ?? []).filter((socket) => (
        new URL(socket.url).pathname === "/api/live"
      ));
      return liveSockets.filter((socket) => socket.readyState === WebSocket.OPEN).map((socket) => socket.url);
    })).toEqual([expect.not.stringContaining("quest_id=")]);
  } finally {
    activeRelease?.();
  }
});

test("same-scope search navigation retains its snapshot while a refresh is in flight", async ({ page }) => {
  test.setTimeout(30_000);
  await installSocketTracking(page);
  let worldReads = 0;
  let holdNextRefresh = false;
  let heldRefresh = false;
  let markRefreshHeld: (() => void) | undefined;
  let releaseRefresh: (() => void) | undefined;
  let markRefreshSettled: (() => void) | undefined;
  const refreshHeld = new Promise<void>((resolve) => {
    markRefreshHeld = resolve;
  });
  const refreshReleased = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  const refreshSettled = new Promise<void>((resolve) => {
    markRefreshSettled = resolve;
  });

  await page.route("**/api/world*", async (route) => {
    worldReads += 1;
    if (!holdNextRefresh) {
      await route.continue();
      return;
    }
    holdNextRefresh = false;
    heldRefresh = true;
    const response = await route.fetch();
    markRefreshHeld?.();
    await refreshReleased;
    await route.fulfill({ response });
    markRefreshSettled?.();
  });

  try {
    await page.goto("/");
    await expect(page.locator(".live-indicator")).toHaveText("LIVE");
    await page.waitForTimeout(100);
    const baselineWorldReads = worldReads;

    holdNextRefresh = true;
    await page.evaluate(() => window.dispatchEvent(new Event("openquest:changed")));
    await refreshHeld;
    expect(worldReads).toBe(baselineWorldReads + 1);

    await page.getByRole("button", { exact: true, name: "OPEN" }).click();
    await expect(page).toHaveURL(/status=open/);
    await expect(page.locator(".loading")).toHaveCount(0);
    expect(worldReads).toBe(baselineWorldReads + 1);

    await page.locator(".work-row").first().click();
    await expect(page.getByRole("dialog", { name: "Challenge inspector" })).toBeVisible();
    await expect(page.locator(".loading")).toHaveCount(0);
    expect(worldReads).toBe(baselineWorldReads + 1);

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Challenge inspector" })).toHaveCount(0);
    await expect(page.locator(".loading")).toHaveCount(0);
    expect(worldReads).toBe(baselineWorldReads + 1);
  } finally {
    if (heldRefresh) {
      releaseRefresh?.();
      await refreshSettled;
    }
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
