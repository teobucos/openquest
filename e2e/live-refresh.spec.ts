import { expect, test } from "@playwright/test";
import { installFakeWebMcp } from "./helpers";

test("a WebMCP mutation waits for a queued fresh render", async ({ browser }) => {
  const session = await browser.newContext({
    extraHTTPHeaders: { "cf-connecting-ip": `e2e-live-${crypto.randomUUID()}` },
  });
  await installFakeWebMcp(session);
  const page = await session.newPage();

  let holdNextWorldRequest = false;
  let releaseHeldResponse: (() => void) | undefined;
  let markHeldResponseStarted: (() => void) | undefined;
  let worldRequests = 0;
  const heldResponseStarted = new Promise<void>((resolve) => {
    markHeldResponseStarted = resolve;
  });
  const heldResponseReleased = new Promise<void>((resolve) => {
    releaseHeldResponse = resolve;
  });

  await page.route("**/api/world*", async (route) => {
    worldRequests += 1;
    if (!holdNextWorldRequest) {
      await route.continue();
      return;
    }
    holdNextWorldRequest = false;
    const staleResponse = await route.fetch();
    markHeldResponseStarted?.();
    await heldResponseReleased;
    await route.fulfill({ response: staleResponse });
  });

  try {
    await page.goto("/");
    await expect(page.getByText("WebMCP · 5 tools ready", { exact: true })).toBeVisible();

    const baselineRequests = worldRequests;
    holdNextWorldRequest = true;
    await page.evaluate(() => window.dispatchEvent(new Event("openquest:changed")));
    await heldResponseStarted;

    const title = `Commit-coherent Quest ${crypto.randomUUID()}`;
    const mutationResponse = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/quests"
    );
    await page.evaluate((questTitle) => {
      const testWindow = window as typeof window & {
        __liveRefreshResult?: {
          result: Awaited<ReturnType<typeof window.__openquestWebMcp.invoke>>;
          settled: boolean;
          visibleAtResolution: boolean;
        };
      };
      void window.__openquestWebMcp.invoke("openquest_propose", {
        description: "A public fixture that proves mutation results wait for the dashboard commit.",
        goal: "Verify that an invalidation queued during an in-flight read cannot be dropped.",
        kind: "quest",
        title: questTitle,
      }).then((result) => {
        testWindow.__liveRefreshResult = {
          result,
          settled: true,
          visibleAtResolution: document.body.textContent?.includes(questTitle) ?? false,
        };
      });
    }, title);
    const response = await mutationResponse;
    expect(response.status()).toBe(201);

    await expect.poll(() => page.evaluate(() => (
      window as typeof window & { __liveRefreshResult?: { settled: boolean } }
    ).__liveRefreshResult?.settled ?? false)).toBe(false);

    releaseHeldResponse?.();

    await expect(page.getByRole("heading", { exact: true, name: title })).toBeVisible();
    await expect.poll(() => worldRequests - baselineRequests).toBeGreaterThanOrEqual(2);
    await expect.poll(() => page.evaluate(() => (
      window as typeof window & {
        __liveRefreshResult?: {
          result: { ok: boolean };
          settled: boolean;
          visibleAtResolution: boolean;
        };
      }
    ).__liveRefreshResult)).toMatchObject({
      result: { ok: true },
      settled: true,
      visibleAtResolution: true,
    });
  } finally {
    releaseHeldResponse?.();
    await session.close();
  }
});
