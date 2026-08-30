import { expect, test, type BrowserContext } from "@playwright/test";
import {
  ApiErrorResponseSchema,
  ContributionResponseSchema,
  CreateChallengeResponseSchema,
  CreateQuestResponseSchema,
  ObserveResponseSchema,
  QuestResponseSchema,
  SubmitContributionResponseSchema,
} from "../src/contracts";
import {
  challengeRow,
  failedTool,
  installFakeWebMcp,
  successfulTool,
} from "./helpers";

test("OpenQuest keeps public reads inert and maps invalid tool input to rejected executions", async ({ browser, request }) => {
  const publicRead = await request.get("/api/world");
  expect(publicRead.status()).toBe(200);
  expect(publicRead.headers()["set-cookie"]).toBeUndefined();

  const readOnlySelection = await request.post("/api/work/next", { data: {} });
  expect(readOnlySelection.status()).toBe(200);
  expect(readOnlySelection.headers()["set-cookie"]).toBeUndefined();

  const secureWrite = await request.post("/api/quests", {
    data: {
      description: "A public E2E security check.",
      goal: "Verify that HTTPS mutations issue the required anonymous session cookie.",
      title: `Secure cookie Quest ${crypto.randomUUID()}`,
    },
    headers: {
      "cf-connecting-ip": `e2e-secure-${crypto.randomUUID()}`,
      "x-forwarded-proto": "https",
    },
  });
  expect(secureWrite.status()).toBe(201);
  const issuedCookie = secureWrite.headers()["set-cookie"] ?? "";
  expect(issuedCookie).toContain("oq_session=");
  expect(issuedCookie).toContain("HttpOnly");
  expect(issuedCookie).toContain("SameSite=Lax");
  expect(issuedCookie).toContain("Secure");

  const session = await browser.newContext({
    extraHTTPHeaders: { "cf-connecting-ip": `e2e-safety-${crypto.randomUUID()}` },
  });
  await installFakeWebMcp(session);
  const page = await session.newPage();

  try {
    await page.goto("/");
    const title = `<script>alert(1)</script> ${crypto.randomUUID()}`;
    const scriptedChallenge = await successfulTool(
      page,
      {
        name: "openquest_propose",
        input: {
          description: "Render this adversarial-looking public title as inert text without executing it.",
          kind: "challenge",
          quest_id: "quest_accessible_hcmc",
          title,
        },
      },
      CreateChallengeResponseSchema,
    );
    await page.goto("/q/accessible-hcmc");
    await expect(challengeRow(page, title)).toBeVisible();
    await expect(page.locator("article.challenge-row script")).toHaveCount(0);
    await expect(page.getByText("5 Site Tools ready", { exact: true })).toBeVisible();

    for (const url of ["javascript:alert(1)", "data:text/plain,unsafe", "file:///tmp/unsafe"]) {
      const error = await failedTool(page, {
        name: "openquest_submit",
        input: {
          challenge_id: scriptedChallenge.challenge_id,
          content: "This mutation must never reach shared state.",
          evidence: [{ title: "Unsafe URL", url }],
          summary: "Unsafe evidence must be rejected.",
        },
      });
      expect(error).toContain("[invalid_input]");
    }

    const whitespaceError = await failedTool(page, {
      name: "openquest_submit",
      input: {
        challenge_id: scriptedChallenge.challenge_id,
        content: "   \n\t",
        summary: "Whitespace-only content must be rejected.",
      },
    });
    expect(whitespaceError).toContain("[invalid_input]");

    const invalidWorkerResponse = await page.request.post("/api/contributions", {
      data: {
        challenge_id: scriptedChallenge.challenge_id,
        content: "x".repeat(12_001),
        summary: "Direct HTTP validation",
      },
    });
    expect(invalidWorkerResponse.status()).toBe(400);
    expect(ApiErrorResponseSchema.parse(await invalidWorkerResponse.json()).status).toBe("invalid_input");
  } finally {
    await session.close();
  }
});

test("D1 state transitions turn concurrent writes into product conflicts, not 500s", async ({ browser }) => {
  const sessionA = await browser.newContext({
    extraHTTPHeaders: { "cf-connecting-ip": `e2e-race-a-${crypto.randomUUID()}` },
  });
  const sessionB = await browser.newContext({
    extraHTTPHeaders: { "cf-connecting-ip": `e2e-race-b-${crypto.randomUUID()}` },
  });
  const sessionC = await browser.newContext({
    extraHTTPHeaders: { "cf-connecting-ip": `e2e-race-c-${crypto.randomUUID()}` },
  });
  await installFakeWebMcp(sessionA);
  const pageA = await sessionA.newPage();
  const pageB = await sessionB.newPage();
  const pageC = await sessionC.newPage();

  try {
    await Promise.all([pageA.goto("/"), pageB.goto("/"), pageC.goto("/")]);
    const createdQuest = await successfulTool(
      pageA,
      {
        name: "openquest_propose",
        input: {
          description: "A public Quest used to prove concurrent database state transitions.",
          goal: "Verify that concurrent writes receive deterministic product errors instead of server failures.",
          kind: "quest",
          title: `Race Quest ${crypto.randomUUID()}`,
        },
      },
      CreateQuestResponseSchema,
    );

    const contributionRaceChallenge = await pageA.request.post("/api/challenges", {
      data: {
        description: "Allow exactly one pending Contribution while concurrent submissions race.",
        quest_id: createdQuest.quest_id,
        title: `Contribution race ${crypto.randomUUID()}`,
      },
    });
    expect(contributionRaceChallenge.status()).toBe(201);
    const contributionChallenge = CreateChallengeResponseSchema.parse(
      await contributionRaceChallenge.json(),
    );

    const contributionResponses = await Promise.all([
      pageA.request.post("/api/contributions", {
        data: {
          challenge_id: contributionChallenge.challenge_id,
          content: "Contribution from the first concurrent writer.",
          summary: "First concurrent Contribution.",
        },
      }),
      pageB.request.post("/api/contributions", {
        data: {
          challenge_id: contributionChallenge.challenge_id,
          content: "Contribution from the second concurrent writer.",
          summary: "Second concurrent Contribution.",
        },
      }),
    ]);
    expect(contributionResponses.map((response) => response.status()).sort()).toEqual([201, 409]);
    const contributionBodies = await Promise.all(contributionResponses.map((response) => response.json()));
    const winningContribution = contributionBodies
      .map((body) => SubmitContributionResponseSchema.safeParse(body))
      .find((parsed) => parsed.success);
    expect(winningContribution?.success).toBe(true);
    const contributionConflict = contributionBodies
      .map((body) => ApiErrorResponseSchema.safeParse(body))
      .find((parsed) => parsed.success && parsed.data.status === "challenge_unavailable");
    expect(contributionConflict?.success).toBe(true);

    const reviewRaceChallengeResponse = await pageA.request.post("/api/challenges", {
      data: {
        description: "Allow exactly one terminal Review while concurrent reviewers race.",
        quest_id: createdQuest.quest_id,
        title: `Review race ${crypto.randomUUID()}`,
      },
    });
    expect(reviewRaceChallengeResponse.status()).toBe(201);
    const reviewChallenge = CreateChallengeResponseSchema.parse(await reviewRaceChallengeResponse.json());
    const pendingContributionResponse = await pageA.request.post("/api/contributions", {
      data: {
        challenge_id: reviewChallenge.challenge_id,
        content: "A pending Contribution for concurrent independent Review.",
        summary: "Review race Contribution.",
      },
    });
    expect(pendingContributionResponse.status()).toBe(201);
    const pendingContribution = SubmitContributionResponseSchema.parse(
      await pendingContributionResponse.json(),
    );

    const reviewResponses = await Promise.all([
      pageB.request.post("/api/reviews", {
        data: {
          contribution_id: pendingContribution.contribution_id,
          reason: "Independent reviewer B completed the race path.",
          verdict: "support",
        },
      }),
      pageC.request.post("/api/reviews", {
        data: {
          contribution_id: pendingContribution.contribution_id,
          reason: "Independent reviewer C completed the race path.",
          verdict: "challenge",
        },
      }),
    ]);
    expect(reviewResponses.map((response) => response.status()).sort()).toEqual([201, 409]);
    const reviewBodies = await Promise.all(reviewResponses.map((response) => response.json()));
    const reviewConflict = reviewBodies
      .map((body) => ApiErrorResponseSchema.safeParse(body))
      .find((parsed) => parsed.success && parsed.data.status === "contribution_unavailable");
    expect(reviewConflict?.success).toBe(true);
  } finally {
    await sessionA.close();
    await sessionB.close();
    await sessionC.close();
  }
});

test("Quest previews stay bounded and omit full Contribution work", async ({ browser }) => {
  test.setTimeout(120_000);
  const owner = await browser.newContext({
    extraHTTPHeaders: { "cf-connecting-ip": `e2e-bounds-owner-${crypto.randomUUID()}` },
  });
  await installFakeWebMcp(owner);
  const ownerPage = await owner.newPage();
  const writerContexts: BrowserContext[] = [];
  const nearMaximumContent = "x".repeat(12_000);

  try {
    await ownerPage.goto("/");
    const createdQuest = await successfulTool(
      ownerPage,
      {
        name: "openquest_propose",
        input: {
          description: "A Quest used to verify bounded Challenge previews and compact polling payloads.",
          goal: "Verify that monitoring remains correct and compact after more than one hundred Challenges.",
          kind: "quest",
          title: `Bounded previews ${crypto.randomUUID()}`,
        },
      },
      CreateQuestResponseSchema,
    );

    let firstContributionId: string | null = null;
    for (let index = 0; index < 101; index += 1) {
      const writer = await browser.newContext({
        extraHTTPHeaders: { "cf-connecting-ip": `e2e-bounds-${index}-${crypto.randomUUID()}` },
      });
      writerContexts.push(writer);
      const challengeResponse = await writer.request.post("/api/challenges", {
        data: {
          description: `Create compact preview fixture ${index} without changing the public data-model rules.`,
          quest_id: createdQuest.quest_id,
          title: `Bounded preview Challenge ${index} ${crypto.randomUUID()}`,
        },
      });
      expect(challengeResponse.status()).toBe(201);
      const challenge = CreateChallengeResponseSchema.parse(await challengeResponse.json());
      if (index === 100) continue;
      const contributionResponse = await writer.request.post("/api/contributions", {
        data: {
          challenge_id: challenge.challenge_id,
          content: nearMaximumContent,
          summary: `Near-maximal preview fixture ${index}`,
        },
      });
      expect(contributionResponse.status()).toBe(201);
      const contribution = SubmitContributionResponseSchema.parse(await contributionResponse.json());
      firstContributionId ??= contribution.contribution_id;
    }

    const detailResponse = await ownerPage.request.get(`/api/quests/${createdQuest.slug}`);
    expect(detailResponse.status()).toBe(200);
    const detail = QuestResponseSchema.parse(await detailResponse.json());
    expect(detail.challenges).toHaveLength(100);
    expect(detail.counts.open + detail.counts.awaiting_review + detail.counts.resolved).toBe(101);

    const observeResponse = await ownerPage.request.get(`/api/world?quest_id=${createdQuest.quest_id}`);
    expect(observeResponse.status()).toBe(200);
    const observed = ObserveResponseSchema.parse(await observeResponse.json());
    expect(observed.challenges).toHaveLength(100);
    for (const challenge of observed.challenges ?? []) {
      if (!challenge.contribution) continue;
      expect(challenge.contribution).not.toHaveProperty("actor_label");
      expect(challenge.contribution).not.toHaveProperty("content");
      expect(challenge.contribution).not.toHaveProperty("evidence");
    }

    if (!firstContributionId) throw new Error("Expected a Contribution fixture.");
    const fullContributionResponse = await ownerPage.request.get(`/api/contributions/${firstContributionId}`);
    expect(fullContributionResponse.status()).toBe(200);
    expect(ContributionResponseSchema.parse(await fullContributionResponse.json()).contribution.content)
      .toBe(nearMaximumContent);
  } finally {
    await owner.close();
    await Promise.all(writerContexts.map((context) => context.close()));
  }
});
