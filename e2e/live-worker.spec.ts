import { expect, test, type Page } from "@playwright/test";
import {
  CreateChallengeResponseSchema,
  CreateQuestResponseSchema,
  ReviewContributionResponseSchema,
  SubmitContributionResponseSchema,
} from "../src/contracts";

declare global {
  interface Window {
    __openquestTrackedSockets?: WebSocket[];
  }
}

function challengeRow(page: Page, title: string) {
  return page.locator(".work-row").filter({ hasText: title });
}

async function createQuest(page: Page, title: string) {
  const response = await page.request.post("/api/quests", {
    data: {
      description: "A real Worker fixture used to verify live control-center state propagation.",
      goal: "Prove two isolated dashboard sessions receive canonical D1 state through WebSocket invalidation.",
      title,
    },
  });
  expect(response.status()).toBe(201);
  return CreateQuestResponseSchema.parse(await response.json());
}

async function createChallenge(page: Page, questId: string, title: string) {
  const response = await page.request.post("/api/challenges", {
    data: {
      description: "A real Worker Challenge used to verify open, Review, and resolved dashboard rows without polling.",
      quest_id: questId,
      title,
    },
  });
  expect(response.status()).toBe(201);
  return CreateChallengeResponseSchema.parse(await response.json());
}

async function openQuestDashboard(page: Page, slug: string, title: string) {
  const response = await page.goto(`/q/${slug}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: `OPENQUEST / ${title}` })).toBeVisible();
  await expect(page.locator(".live-indicator")).toHaveText("LIVE");
}

test("the generated Worker assets serve the real control-center SPA", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["content-type"]).toContain("text/html");
  await expect(page.getByRole("heading", { name: "OPENQUEST CONTROL CENTER" })).toBeVisible();
  await expect(page.locator(".live-indicator")).toHaveText("LIVE");
});

test("two isolated dashboards receive open, Review, and Result state through Worker WebSockets", async ({ browser }) => {
  test.setTimeout(60_000);
  const contributor = await browser.newContext({
    extraHTTPHeaders: { "cf-connecting-ip": `live-contributor-${crypto.randomUUID()}` },
  });
  const reviewer = await browser.newContext({
    extraHTTPHeaders: { "cf-connecting-ip": `live-reviewer-${crypto.randomUUID()}` },
  });
  const contributorPage = await contributor.newPage();
  const reviewerPage = await reviewer.newPage();
  let reviewerWorldReads = 0;
  reviewerPage.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/world") reviewerWorldReads += 1;
  });

  try {
    await contributorPage.goto("/");
    const questTitle = `Live dashboard Quest ${crypto.randomUUID()}`;
    const quest = await createQuest(contributorPage, questTitle);
    await openQuestDashboard(contributorPage, quest.slug, questTitle);
    await openQuestDashboard(reviewerPage, quest.slug, questTitle);
    await reviewerPage.waitForTimeout(300);
    const healthyWorldReads = reviewerWorldReads;
    await reviewerPage.waitForTimeout(1_600);
    expect(reviewerWorldReads).toBe(healthyWorldReads);

    const challengeTitle = `Live state Challenge ${crypto.randomUUID()}`;
    const challenge = await createChallenge(contributorPage, quest.quest_id, challengeTitle);
    await expect(challengeRow(reviewerPage, challengeTitle)).toHaveAttribute("data-state", "open");
    await expect(reviewerPage.getByTestId("activity-list")).toContainText(`New Challenge: ${challengeTitle}`);

    const submittedResponse = await contributorPage.request.post("/api/contributions", {
      data: {
        challenge_id: challenge.challenge_id,
        content: "This complete public Contribution is sent while both real dashboard sockets are healthy.",
        evidence: [{ title: "Live contribution evidence", url: "https://example.com/live-contribution" }],
        summary: "A live Contribution ready for independent Review.",
      },
    });
    expect(submittedResponse.status()).toBe(201);
    const submitted = SubmitContributionResponseSchema.parse(await submittedResponse.json());
    await expect(challengeRow(reviewerPage, challengeTitle)).toHaveAttribute("data-state", "review");
    await expect(reviewerPage.getByTestId("activity-list")).toContainText("Contribution submitted");

    const reviewResponse = await reviewerPage.request.post("/api/reviews", {
      data: {
        contribution_id: submitted.contribution_id,
        evidence: [{ title: "Live review evidence", url: "https://example.com/live-review" }],
        reason: "The isolated reviewer confirmed this public Contribution.",
        verdict: "support",
      },
    });
    expect(reviewResponse.status()).toBe(201);
    ReviewContributionResponseSchema.parse(await reviewResponse.json());
    await expect(challengeRow(contributorPage, challengeTitle)).toHaveAttribute("data-state", "resolved");
    await expect(challengeRow(reviewerPage, challengeTitle)).toHaveAttribute("data-state", "resolved");
    await expect(contributorPage.getByTestId("activity-list")).toContainText(`Resolved: ${challengeTitle}`);
  } finally {
    await contributor.close();
    await reviewer.close();
  }
});

test("a disconnected dashboard refreshes missed canonical D1 state after reconnecting", async ({ browser }) => {
  test.setTimeout(60_000);
  const disconnected = await browser.newContext({
    extraHTTPHeaders: { "cf-connecting-ip": `live-disconnected-${crypto.randomUUID()}` },
  });
  await disconnected.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    const sockets: WebSocket[] = [];
    class TrackingWebSocket extends NativeWebSocket {
      public constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        sockets.push(this);
      }
    }
    window.__openquestTrackedSockets = sockets;
    window.WebSocket = TrackingWebSocket;
  });
  const writer = await browser.newContext({
    extraHTTPHeaders: { "cf-connecting-ip": `live-writer-${crypto.randomUUID()}` },
  });
  const disconnectedPage = await disconnected.newPage();
  const writerPage = await writer.newPage();

  try {
    await disconnectedPage.goto("/");
    const questTitle = `Recovery Quest ${crypto.randomUUID()}`;
    const quest = await createQuest(disconnectedPage, questTitle);
    await openQuestDashboard(disconnectedPage, quest.slug, questTitle);
    await openQuestDashboard(writerPage, quest.slug, questTitle);

    await expect.poll(() => disconnectedPage.evaluate(() => window.__openquestTrackedSockets?.length ?? 0))
      .toBeGreaterThan(0);
    await disconnectedPage.evaluate(async () => {
      let socket: WebSocket | undefined;
      for (const candidate of window.__openquestTrackedSockets ?? []) {
        if (candidate.readyState === WebSocket.OPEN) socket = candidate;
      }
      if (!socket) throw new Error("Expected the dashboard's native live socket to be open.");
      await new Promise<void>((resolve) => {
        socket.addEventListener("close", () => resolve(), { once: true });
        socket.close();
      });
    });
    await expect(disconnectedPage.locator(".live-indicator")).toHaveText("RECONNECTING");

    const challengeTitle = `Recovered Challenge ${crypto.randomUUID()}`;
    await createChallenge(writerPage, quest.quest_id, challengeTitle);
    await expect(challengeRow(writerPage, challengeTitle)).toHaveAttribute("data-state", "open");
    await expect(challengeRow(disconnectedPage, challengeTitle)).toHaveCount(0);

    await expect(disconnectedPage.locator(".live-indicator")).toHaveText("LIVE");
    await expect(challengeRow(disconnectedPage, challengeTitle)).toHaveAttribute("data-state", "open");
    await expect(disconnectedPage.getByTestId("activity-list")).toContainText(`New Challenge: ${challengeTitle}`);
  } finally {
    await disconnected.close();
    await writer.close();
  }
});
