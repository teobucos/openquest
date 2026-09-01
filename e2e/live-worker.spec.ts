import { expect, test, type Page } from "@playwright/test";
import { CreateQuestResponseSchema } from "../src/contracts";
import { LIVE_INVALIDATION_TYPE, parseLiveInvalidation } from "../src/liveProtocol";

interface LiveClientState {
  events: number;
  refreshes: number;
  scope: { questId?: string };
  status: string;
}

interface FakeLiveSocket {
  emitClose(): void;
  emitMessage(data: string): void;
  emitOpen(): void;
}

declare global {
  interface Window {
    __openquestFakeLiveSockets?: FakeLiveSocket[];
    __openquestRawLiveMessages?: string[];
    __openquestRawLiveSocket?: WebSocket;
  }
}

async function liveClientState(page: Page): Promise<LiveClientState | undefined> {
  return page.evaluate(() => window.__openquestLiveTest);
}

async function waitForLive(page: Page): Promise<void> {
  await expect.poll(async () => (await liveClientState(page))?.status).toBe("live");
  await expect.poll(async () => (await liveClientState(page))?.refreshes ?? 0).toBeGreaterThan(0);
}

async function openRawLiveSocket(page: Page, path: string): Promise<void> {
  await page.evaluate(async (socketPath) => {
    const messages: string[] = [];
    const socket = new WebSocket(socketPath);
    window.__openquestRawLiveMessages = messages;
    window.__openquestRawLiveSocket = socket;
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("error", () => reject(new Error("WebSocket failed to open.")), { once: true });
      socket.addEventListener("open", () => resolve(), { once: true });
    });
    socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") messages.push(event.data);
    });
  }, path);
}

function expectCompactInvalidation(raw: string): number {
  const parsed = parseLiveInvalidation(raw);
  expect(parsed).not.toBeNull();
  const payload = JSON.parse(raw);
  expect(Object.keys(payload).sort()).toEqual(["latest_sequence", "type"]);
  expect(parsed).toMatchObject({ type: LIVE_INVALIDATION_TYPE });
  return parsed?.latest_sequence ?? 0;
}

test("a committed mutation refreshes an isolated live client through Worker WebSockets", async ({ browser }) => {
  const writer = await browser.newContext({
    extraHTTPHeaders: { "cf-connecting-ip": `live-writer-${crypto.randomUUID()}` },
  });
  const reader = await browser.newContext({
    extraHTTPHeaders: { "cf-connecting-ip": `live-reader-${crypto.randomUUID()}` },
  });
  const writerPage = await writer.newPage();
  const readerPage = await reader.newPage();
  const rawNetworkPage = await reader.newPage();

  try {
    await writerPage.goto("/api/world");
    await readerPage.goto("/e2e/live-client.html");
    await rawNetworkPage.goto("/api/world");
    await openRawLiveSocket(rawNetworkPage, "ws://127.0.0.1:4178/api/live");
    await waitForLive(readerPage);

    const beforeMutation = await liveClientState(readerPage);
    await readerPage.waitForTimeout(1_200);
    expect((await liveClientState(readerPage))?.refreshes).toBe(beforeMutation?.refreshes);

    const createdResponse = await writerPage.evaluate(async (title) => {
      const response = await fetch("/api/quests", {
        body: JSON.stringify({
          description: "A Worker WebSocket verification fixture with no domain payload in its transport message.",
          goal: "Verify that a second session refreshes from a committed mutation without polling.",
          title,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      return { body: await response.text(), status: response.status };
    }, `Live transport Quest ${crypto.randomUUID()}`);
    expect(createdResponse.status).toBe(201);
    const created = CreateQuestResponseSchema.parse(JSON.parse(createdResponse.body));

    await expect.poll(async () => (await liveClientState(readerPage))?.events ?? 0)
      .toBeGreaterThan((beforeMutation?.events ?? 0));
    await expect.poll(async () => rawNetworkPage.evaluate(() => (
      window.__openquestRawLiveMessages?.length ?? 0
    ))).toBe(1);
    const networkMessages = await rawNetworkPage.evaluate(() => window.__openquestRawLiveMessages ?? []);
    const questSequence = expectCompactInvalidation(networkMessages[0] ?? "");

    const questClientPage = await reader.newPage();
    const rawQuestPage = await reader.newPage();
    await questClientPage.goto(`/e2e/live-client.html?quest_id=${encodeURIComponent(created.quest_id)}`);
    await rawQuestPage.goto("/api/world");
    await openRawLiveSocket(rawQuestPage, `ws://127.0.0.1:4178/api/live?quest_id=${encodeURIComponent(created.quest_id)}`);
    await waitForLive(questClientPage);
    expect((await liveClientState(questClientPage))?.scope).toEqual({ questId: created.quest_id });

    const networkBeforeChallenge = await rawNetworkPage.evaluate(() => (
      window.__openquestRawLiveMessages?.length ?? 0
    ));
    const questBeforeChallenge = await rawQuestPage.evaluate(() => (
      window.__openquestRawLiveMessages?.length ?? 0
    ));
    const questClientBefore = await liveClientState(questClientPage);
    const challengeResponse = await writerPage.evaluate(async (questId) => {
      const response = await fetch("/api/challenges", {
        body: JSON.stringify({
          description: "Confirm network and Quest scopes both receive the committed event sequence.",
          quest_id: questId,
          title: "Live scope verification Challenge",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      return response.status;
    }, created.quest_id);
    expect(challengeResponse).toBe(201);

    await expect.poll(async () => rawNetworkPage.evaluate(() => (
      window.__openquestRawLiveMessages?.length ?? 0
    ))).toBe(networkBeforeChallenge + 1);
    await expect.poll(async () => rawQuestPage.evaluate(() => (
      window.__openquestRawLiveMessages?.length ?? 0
    ))).toBe(questBeforeChallenge + 1);
    await expect.poll(async () => (await liveClientState(questClientPage))?.events ?? 0)
      .toBeGreaterThan(questClientBefore?.events ?? 0);

    const questMessages = await rawQuestPage.evaluate(() => window.__openquestRawLiveMessages ?? []);
    const challengeSequence = expectCompactInvalidation(questMessages[0] ?? "");
    expect(challengeSequence).toBeGreaterThan(questSequence);
  } finally {
    await writer.close();
    await reader.close();
  }
});

test("the live hook degrades, falls back, reconnects, and ignores a prior scope generation", async ({ page }) => {
  await page.addInitScript(() => {
    class FakeWebSocket extends EventTarget {
      public static readonly OPEN = 1;
      public readyState = 0;

      public constructor() {
        super();
        window.__openquestFakeLiveSockets ??= [];
        window.__openquestFakeLiveSockets.push(this);
      }

      public close(): void {
        this.readyState = 3;
        this.dispatchEvent(new CloseEvent("close"));
      }

      public emitClose(): void {
        this.close();
      }

      public emitMessage(data: string): void {
        this.dispatchEvent(new MessageEvent("message", { data }));
      }

      public emitOpen(): void {
        this.readyState = FakeWebSocket.OPEN;
        this.dispatchEvent(new Event("open"));
      }
    }

    Object.defineProperty(window, "WebSocket", { configurable: true, value: FakeWebSocket });
  });
  await page.goto("/e2e/live-client.html");
  expect(await page.evaluate(() => window.WebSocket.name)).toBe("FakeWebSocket");
  await expect.poll(() => page.evaluate(() => window.__openquestFakeLiveSockets?.length ?? 0)).toBe(1);
  await expect.poll(async () => (await liveClientState(page))?.status, { timeout: 7_000 }).toBe("degraded");
  await expect.poll(async () => (await liveClientState(page))?.refreshes ?? 0).toBeGreaterThan(0);
  await page.evaluate(() => window.__openquestFakeLiveSockets?.[0]?.emitOpen());
  await waitForLive(page);

  const initial = await liveClientState(page);
  await page.evaluate(() => window.__setOpenQuestLiveScope?.("quest_scope_race"));
  await expect.poll(() => page.evaluate(() => window.__openquestFakeLiveSockets?.length ?? 0)).toBe(2);
  await page.evaluate(() => window.__openquestFakeLiveSockets?.[0]?.emitMessage(
    '{"latest_sequence":99,"type":"openquest.changed"}',
  ));
  await page.waitForTimeout(100);
  expect((await liveClientState(page))?.events).toBe(initial?.events);
  await page.evaluate(() => window.__openquestFakeLiveSockets?.[1]?.emitOpen());
  await waitForLive(page);

  await page.evaluate(() => window.__openquestFakeLiveSockets?.[1]?.emitClose());
  await expect.poll(async () => (await liveClientState(page))?.status).toBe("reconnecting");
  await expect.poll(() => page.evaluate(() => window.__openquestFakeLiveSockets?.length ?? 0)).toBe(3);
  await expect.poll(async () => (await liveClientState(page))?.status, { timeout: 7_000 }).toBe("degraded");

  const degraded = await liveClientState(page);
  await page.evaluate(() => window.__openquestFakeLiveSockets?.[2]?.emitOpen());
  await waitForLive(page);
  const recovered = await liveClientState(page);
  await page.waitForTimeout(750);
  expect((await liveClientState(page))?.events).toBe(recovered?.events);
  expect(recovered?.events).toBeGreaterThan(degraded?.events ?? 0);
});
