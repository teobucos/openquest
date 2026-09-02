import { expect, test, type Page } from "@playwright/test";
import { connect } from "node:net";
import {
  CreateChallengeResponseSchema,
  CreateQuestResponseSchema,
  GetNextWorkResponseSchema,
  ReviewContributionResponseSchema,
  SubmitContributionResponseSchema,
} from "../src/contracts";
import {
  installFakeWebMcp,
  registeredTools,
  successfulTool,
} from "./helpers";

declare global {
  interface Window {
    __openquestTrackedSockets?: WebSocket[];
  }
}

function challengeRow(page: Page, title: string) {
  return page.locator(".work-row").filter({ hasText: title });
}

function rawLiveHandshake(path: string, origin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(4178, "127.0.0.1");
    let response = "";
    let settled = false;

    const complete = (result: string | Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    socket.setTimeout(5_000, () => complete(new Error("Timed out waiting for live WebSocket handshake.")));
    socket.once("error", (error) => complete(error));
    socket.once("connect", () => {
      const headers = [
        `GET ${path} HTTP/1.1`,
        "Host: 127.0.0.1:4178",
        "Connection: Upgrade",
        "Upgrade: websocket",
        "Sec-WebSocket-Key: b3BlbnF1ZXN0LWxpdmUtdGVzdA==",
        "Sec-WebSocket-Version: 13",
      ];
      if (origin) headers.push(`Origin: ${origin}`);
      socket.write(`${headers.join("\r\n")}\r\n\r\n`);
    });
    socket.on("data", (chunk: Buffer) => {
      response += chunk.toString();
      if (response.includes("\r\n\r\n")) complete(response);
    });
    socket.once("end", () => complete(response));
  });
}

const expectedToolNames = [
  "openquest_next",
  "openquest_observe",
  "openquest_propose",
  "openquest_review",
  "openquest_submit",
];

function metricValue(page: Page, label: string) {
  return page.locator(".telemetry-cell").filter({ hasText: label }).locator("strong");
}

async function latestSequence(page: Page): Promise<number> {
  const text = await page.getByTestId("latest-event-indicator").innerText();
  const match = /#(\d+)$/.exec(text);
  if (!match) throw new Error(`Expected a latest event sequence, received: ${text}`);
  return Number(match[1]);
}

async function expectFiveWebMcpTools(page: Page): Promise<void> {
  await expect(page.getByText("WebMCP · 5 tools ready", { exact: true })).toBeVisible();
  expect((await registeredTools(page)).map((tool) => tool.name)).toEqual(expectedToolNames);
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

test("the real Worker validates live scope and Origin before accepting a socket", async () => {
  const missingQuest = await rawLiveHandshake(
    `/api/live?quest_id=quest_missing_${crypto.randomUUID().replaceAll("-", "")}`,
  );
  expect(missingQuest).toMatch(/^HTTP\/1\.1 404\b/);

  const mismatchedOrigin = await rawLiveHandshake("/api/live", "http://other.example");
  expect(mismatchedOrigin).toMatch(/^HTTP\/1\.1 403\b/);

  const absentOrigin = await rawLiveHandshake("/api/live");
  expect(absentOrigin).toMatch(/^HTTP\/1\.1 101\b/);
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

test("WebMCP contributions and Reviews propagate through the real Worker live path", async ({ browser }) => {
  test.setTimeout(60_000);
  const agentA = await browser.newContext({
    extraHTTPHeaders: { "cf-connecting-ip": `live-webmcp-a-${crypto.randomUUID()}` },
  });
  const agentB = await browser.newContext({
    extraHTTPHeaders: { "cf-connecting-ip": `live-webmcp-b-${crypto.randomUUID()}` },
  });
  await Promise.all([installFakeWebMcp(agentA), installFakeWebMcp(agentB)]);
  const agentAPage = await agentA.newPage();
  const agentBPage = await agentB.newPage();
  let agentAWorldReads = 0;
  let agentBWorldReads = 0;
  agentAPage.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/world") agentAWorldReads += 1;
  });
  agentBPage.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/world") agentBWorldReads += 1;
  });

  try {
    await agentAPage.goto("/");
    const questTitle = `WebMCP live Quest ${crypto.randomUUID()}`;
    const quest = await createQuest(agentAPage, questTitle);
    const challengeTitle = `WebMCP live Challenge ${crypto.randomUUID()}`;
    const challenge = await createChallenge(agentAPage, quest.quest_id, challengeTitle);

    await Promise.all([
      openQuestDashboard(agentAPage, quest.slug, questTitle),
      openQuestDashboard(agentBPage, quest.slug, questTitle),
    ]);
    await Promise.all([expectFiveWebMcpTools(agentAPage), expectFiveWebMcpTools(agentBPage)]);

    await agentAPage.waitForTimeout(300);
    const healthyAgentAReads = agentAWorldReads;
    const healthyAgentBReads = agentBWorldReads;
    await Promise.all([agentAPage.waitForTimeout(1_600), agentBPage.waitForTimeout(1_600)]);
    expect(agentAWorldReads).toBe(healthyAgentAReads);
    expect(agentBWorldReads).toBe(healthyAgentBReads);

    const sequenceBeforeContribution = await latestSequence(agentBPage);
    const contributionWork = await successfulTool(
      agentAPage,
      { name: "openquest_next", input: { quest_id: quest.quest_id } },
      GetNextWorkResponseSchema,
    );
    expect(contributionWork).toMatchObject({
      challenge: { id: challenge.challenge_id },
      status: "work_available",
      work_type: "contribute",
    });
    if (contributionWork.status !== "work_available" || contributionWork.work_type !== "contribute") {
      throw new Error("Expected Agent A to receive Contribution work.");
    }

    const contributionSummary = "WebMCP contribution ready for independent Review.";
    const submitted = await successfulTool(
      agentAPage,
      {
        name: "openquest_submit",
        input: {
          challenge_id: contributionWork.challenge.id,
          content: "This public Contribution was submitted through the native-style WebMCP adapter against the real Worker.",
          evidence: [{ title: "WebMCP live contribution evidence", url: "https://example.com/webmcp-live-contribution" }],
          summary: contributionSummary,
        },
      },
      SubmitContributionResponseSchema,
    );
    expect(submitted.status).toBe("submitted");
    await expect(challengeRow(agentAPage, challengeTitle)).toHaveAttribute("data-state", "review");
    await expect(challengeRow(agentBPage, challengeTitle)).toHaveAttribute("data-state", "review");
    await expect(challengeRow(agentBPage, challengeTitle)).toContainText(contributionSummary);
    await expect(agentBPage.getByTestId("activity-list")).toContainText("Contribution submitted");
    await expect(metricValue(agentBPage, "Needs Review")).toHaveText("1");
    await expect(metricValue(agentBPage, "Open")).toHaveText("0");
    const sequenceAfterContribution = await latestSequence(agentBPage);
    expect(sequenceAfterContribution).toBeGreaterThan(sequenceBeforeContribution);

    const reviewWork = await successfulTool(
      agentBPage,
      { name: "openquest_next", input: { quest_id: quest.quest_id } },
      GetNextWorkResponseSchema,
    );
    expect(reviewWork).toMatchObject({
      contribution: { id: submitted.contribution_id },
      status: "work_available",
      work_type: "review",
    });
    if (reviewWork.status !== "work_available" || reviewWork.work_type !== "review") {
      throw new Error("Expected Agent B to receive Review work first.");
    }

    const reviewed = await successfulTool(
      agentBPage,
      {
        name: "openquest_review",
        input: {
          contribution_id: reviewWork.contribution.id,
          evidence: [{ title: "WebMCP live review evidence", url: "https://example.com/webmcp-live-review" }],
          reason: "A separate anonymous Agent session independently verified this public Contribution.",
          verdict: "support",
        },
      },
      ReviewContributionResponseSchema,
    );
    expect(reviewed).toMatchObject({ challenge_status: "resolved", verdict: "support" });
    await expect(challengeRow(agentAPage, challengeTitle)).toHaveAttribute("data-state", "resolved");
    await expect(challengeRow(agentAPage, challengeTitle)).toContainText(contributionSummary);
    await expect(agentAPage.getByTestId("activity-list")).toContainText(`Resolved: ${challengeTitle}`);
    await expect(metricValue(agentAPage, "Needs Review")).toHaveText("0");
    await expect(metricValue(agentAPage, "Resolved")).toHaveText("1");
    expect(await latestSequence(agentAPage)).toBeGreaterThan(sequenceAfterContribution);
  } finally {
    await agentA.close();
    await agentB.close();
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
