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
  domainErrorTool,
  installFakeWebMcp,
  successfulTool,
} from "./helpers";

test("home explains unsupported WebMCP and an empty active Quest list", async ({ page }) => {
  await page.route("**/api/world*", (route) => route.fulfill({
    body: JSON.stringify({
      activity: [],
      contributor_count: 0,
      freshness: { event_count: 0, last_sequence: 0, server_time: "2026-08-30T12:00:00.000Z" },
      quests: [],
      recent_contributors: [],
      totals: { awaiting_review: 0, open: 0, resolved: 0 },
      work_stream: [],
    }),
    contentType: "application/json",
    status: 200,
  }));

  await page.goto("/");
  await expect(page.getByText("WebMCP · browser unsupported", { exact: true })).toBeVisible();
  const emptyQuestCopy = page.getByText(
    "No active Quests.",
    { exact: true },
  );
  await expect(emptyQuestCopy).toBeVisible();
  expect(await emptyQuestCopy.innerText()).toBe(
    "No active Quests.",
  );
});

test("OpenQuest keeps public reads inert and returns invalid tool input as structured results", async ({ browser, request }) => {
  const publicRead = await request.get("/api/world");
  expect(publicRead.status()).toBe(200);
  expect(publicRead.headers()["set-cookie"]).toBeUndefined();

  const readOnlySelection = await request.post("/api/work/next", { data: {} });
  expect(readOnlySelection.status()).toBe(200);
  expect(readOnlySelection.headers()["set-cookie"]).toBeUndefined();

  const malformedBody = await request.post("/api/work/next", {
    data: Buffer.from("{ malformed JSON"),
    headers: { "content-type": "application/json" },
  });
  expect(malformedBody.status()).toBe(400);
  const malformedPayload = ApiErrorResponseSchema.parse(await malformedBody.json());
  expect(malformedPayload.status).toBe("invalid_input");
  expect(malformedPayload.message).toBe("Request body must be valid JSON.");

  const inactiveQuestChallenge = await request.post("/api/challenges", {
    data: {
      description: "The D1 trigger must reject a Challenge whose Quest does not exist.",
      quest_id: "quest_missing_for_trigger_test",
      title: "Database-owned active Quest invariant",
    },
    headers: { "cf-connecting-ip": `e2e-trigger-${crypto.randomUUID()}` },
  });
  expect(inactiveQuestChallenge.status()).toBe(409);
  const inactiveQuestPayload = ApiErrorResponseSchema.parse(await inactiveQuestChallenge.json());
  expect(inactiveQuestPayload.status).toBe("quest_unavailable");

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
  const secureQuest = CreateQuestResponseSchema.parse(await secureWrite.json());

  const readableChallengeResponse = await request.post("/api/challenges", {
    data: {
      description: "Create public read coverage for a Challenge detail endpoint without issuing a read cookie.",
      quest_id: secureQuest.quest_id,
      title: "Public read-only Challenge",
    },
  });
  expect(readableChallengeResponse.status()).toBe(201);
  const readableChallenge = CreateChallengeResponseSchema.parse(await readableChallengeResponse.json());
  const readableContributionResponse = await request.post("/api/contributions", {
    data: {
      challenge_id: readableChallenge.challenge_id,
      content: "Create one public Contribution so its detail read can prove it never initializes a session.",
      summary: "Public detail read fixture.",
    },
  });
  expect(readableContributionResponse.status()).toBe(201);
  const readableContribution = SubmitContributionResponseSchema.parse(
    await readableContributionResponse.json(),
  );

  const directPublicReads = await Promise.all([
    request.get(`/api/challenges/${readableChallenge.challenge_id}`),
    request.get(`/api/quests/${secureQuest.slug}`),
    request.get(`/api/contributions/${readableContribution.contribution_id}`),
    request.get("/api/live"),
    request.get("/api/live?quest_id=not%20a%20canonical%20id"),
    request.post("/api/live"),
  ]);
  expect(directPublicReads.map((response) => response.status())).toEqual([200, 200, 200, 426, 426, 405]);
  for (const response of directPublicReads) {
    expect(response.headers()["set-cookie"]).toBeUndefined();
  }

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
    await expect(page.locator(".work-row script")).toHaveCount(0);
    await expect(page.getByText("WebMCP · 5 tools ready", { exact: true })).toBeVisible();

    for (const url of ["javascript:alert(1)", "data:text/plain,unsafe", "file:///tmp/unsafe"]) {
      const error = await domainErrorTool(page, {
        name: "openquest_submit",
        input: {
          challenge_id: scriptedChallenge.challenge_id,
          content: "This mutation must never reach shared state.",
          evidence: [{ title: "Unsafe URL", url }],
          summary: "Unsafe evidence must be rejected.",
        },
      }, "invalid_input");
      expect(error.status).toBe("invalid_input");
    }

    const whitespaceError = await domainErrorTool(page, {
      name: "openquest_submit",
      input: {
        challenge_id: scriptedChallenge.challenge_id,
        content: "   \n\t",
        summary: "Whitespace-only content must be rejected.",
      },
    }, "invalid_input");
    expect(whitespaceError.status).toBe("invalid_input");

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
  const questTitle = `Bounded previews ${crypto.randomUUID()}`;

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
          title: questTitle,
        },
      },
      CreateQuestResponseSchema,
    );

    writerContexts.push(...await Promise.all(
      Array.from({ length: 10 }, (_, index) => browser.newContext({
        extraHTTPHeaders: { "cf-connecting-ip": `e2e-bounds-${index}-${crypto.randomUUID()}` },
      })),
    ));

    let firstContributionId: string | null = null;
    for (let index = 0; index < 101; index += 1) {
      const writer = writerContexts[index % writerContexts.length];
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
    expect(detail.challenges).toHaveLength(30);
    expect(detail.counts.open + detail.counts.awaiting_review + detail.counts.resolved).toBe(101);

    const observeResponse = await ownerPage.request.get(`/api/world?quest_id=${createdQuest.quest_id}`);
    expect(observeResponse.status()).toBe(200);
    const observed = ObserveResponseSchema.parse(await observeResponse.json());
    expect(observed.challenges).toHaveLength(30);
    expect(observed.work_stream.filter((item) => item.stream_state === "review")).toHaveLength(10);
    expect(observed.work_stream.filter((item) => item.stream_state === "open")).toHaveLength(1);
    expect(observed.recent_contributors).toHaveLength(10);
    expect(observed.freshness.last_sequence).toBe(observed.activity[0]?.sequence);
    expect(new Date(observed.freshness.server_time).getTime()).not.toBeNaN();
    for (const event of observed.activity) {
      expect(event.quest_id).toBe(createdQuest.quest_id);
      expect(event.quest_slug).toBe(createdQuest.slug);
      expect(event.quest_title).toBe(questTitle);
    }
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
