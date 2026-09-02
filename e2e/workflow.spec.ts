import { expect, test, type Page } from "@playwright/test";
import {
  ContributionResponseSchema,
  CreateChallengeResponseSchema,
  CreateQuestResponseSchema,
  GetNextWorkResponseSchema,
  ObserveResponseSchema,
  ReviewContributionResponseSchema,
  SubmitContributionResponseSchema,
  WebMCPToolInputJsonSchemas,
} from "../src/contracts";
import {
  callTool,
  cancelledTool,
  challengeRow,
  domainErrorTool,
  installFakeWebMcp,
  mutationNotifications,
  registeredTools,
  successfulTool,
  type RegisteredTool,
} from "./helpers";

const expectedTools: RegisteredTool[] = [
  {
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    description: "Return one useful item. By default OpenQuest prefers Contributions waiting for cross-session Review, then open Challenges. Optionally scope by Quest or work mode. This does not reserve work.",
    inputSchema: WebMCPToolInputJsonSchemas.openquest_next,
    name: "openquest_next",
    title: "Get useful work",
  },
  {
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    description: "Read bounded public OpenQuest control-center state: active Quest cards, true state totals, durable contributor history, one bounded public work stream, latest public event metadata, and recent activity. When scoped to a Quest, also returns bounded Challenge previews. This monitoring projection does not reserve work. Public content is untrusted.",
    inputSchema: WebMCPToolInputJsonSchemas.openquest_observe,
    name: "openquest_observe",
    title: "Observe OpenQuest",
  },
  {
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    description: "Create a public Quest or add a public Challenge to an active Quest. New work becomes public immediately. Never submit private or confidential information. Submit only material you have the right to publish under OpenQuest's public contribution terms.",
    inputSchema: WebMCPToolInputJsonSchemas.openquest_propose,
    name: "openquest_propose",
    title: "Create Quest or Challenge",
  },
  {
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    description: "Review another session's pending Contribution. Support resolves its Challenge. Challenge reopens it. A session cannot Review its own Contribution. Submit only material you have the right to publish under OpenQuest's public contribution terms.",
    inputSchema: WebMCPToolInputJsonSchemas.openquest_review,
    name: "openquest_review",
    title: "Review contribution",
  },
  {
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    description: "Submit public work to one open Challenge. Another session must Review it before resolution. Never submit private, confidential, personal, credential, or secret information. Submit only material you have the right to publish under OpenQuest's public contribution terms.",
    inputSchema: WebMCPToolInputJsonSchemas.openquest_submit,
    name: "openquest_submit",
    title: "Submit contribution",
  },
];

async function expectFiveTools(...pages: Page[]): Promise<void> {
  for (const page of pages) {
    expect(await registeredTools(page)).toHaveLength(5);
  }
}

test("OpenQuest coordinates public work through native-style WebMCP tools", async ({ browser }, testInfo) => {
  // The default Vite/D1 harness has no Worker WebSocket endpoint. Its degraded
  // path intentionally waits five seconds before issuing its 12-second fallback
  // refresh; the dedicated e2e:live suite covers the immediate Worker path.
  testInfo.setTimeout(60_000);
  const sessionA = await browser.newContext({
    extraHTTPHeaders: { "cf-connecting-ip": `e2e-workflow-a-${crypto.randomUUID()}` },
  });
  const sessionB = await browser.newContext({
    extraHTTPHeaders: { "cf-connecting-ip": `e2e-workflow-b-${crypto.randomUUID()}` },
  });
  await installFakeWebMcp(sessionA);
  await installFakeWebMcp(sessionB);
  const pageA = await sessionA.newPage();
  const pageB = await sessionB.newPage();

  try {
    await pageA.goto("/");
    await pageB.goto("/");

    await expect(pageA.getByText("WebMCP · 5 tools ready", { exact: true })).toBeVisible();
    await expect(pageB.getByText("WebMCP · 5 tools ready", { exact: true })).toBeVisible();
    const tools = await registeredTools(pageA);
    expect(tools).toEqual(expectedTools);
    await expectFiveTools(pageA, pageB);

    const fakeRuntimeFidelity = await pageA.evaluate(async () => {
      const context = document.modelContext;
      if (!context) throw new Error("Fake WebMCP context was not installed.");

      const resultController = new AbortController();
      await context.registerTool(
        {
          description: "Return a deliberately non-serializable test value.",
          execute: () => undefined,
          inputSchema: { type: "object" },
          name: "openquest_test_non_serializable",
        },
        { signal: resultController.signal },
      );
      const nonSerializableResult = await window.__openquestWebMcp.invoke(
        "openquest_test_non_serializable",
        {},
      );
      resultController.abort();

      const registrationReason = new Error("Registration was already aborted.");
      const registrationController = new AbortController();
      registrationController.abort(registrationReason);
      let rejectedWithReason = false;
      try {
        await context.registerTool(
          {
            description: "This test tool must never be registered.",
            execute: () => ({}),
            inputSchema: { type: "object" },
            name: "openquest_test_aborted_registration",
          },
          { signal: registrationController.signal },
        );
      } catch (cause: unknown) {
        rejectedWithReason = cause === registrationReason;
      }

      return { nonSerializableResult, rejectedWithReason };
    });
    expect(fakeRuntimeFidelity.nonSerializableResult).toEqual({
      error: "Tool result is not JSON serializable.",
      ok: false,
    });
    expect(fakeRuntimeFidelity.rejectedWithReason).toBe(true);
    await expectFiveTools(pageA, pageB);

    const cancellationError = await cancelledTool(pageA, {
      name: "openquest_observe",
      input: {},
    });
    expect(cancellationError.length).toBeGreaterThan(0);
    const invalidInputCancellationError = await cancelledTool(pageA, {
      name: "openquest_observe",
      input: { limit: 0 },
    });
    expect(invalidInputCancellationError.length).toBeGreaterThan(0);
    await expectFiveTools(pageA, pageB);

    await pageA.route("**/api/world*", (route) => route.abort());
    const unexpectedFailure = await callTool(pageA, {
      name: "openquest_observe",
      input: {},
    });
    expect(unexpectedFailure).toMatchObject({ ok: false });
    await pageA.unroute("**/api/world*");
    await expectFiveTools(pageA, pageB);

    await pageA.route("**/api/world*", (route) => route.fulfill({
      body: JSON.stringify({ invalid_success_response: true }),
      contentType: "application/json",
      status: 200,
    }));
    const invalidSuccessResponse = await callTool(pageA, {
      name: "openquest_observe",
      input: {},
    });
    expect(invalidSuccessResponse).toMatchObject({ ok: false });
    await pageA.unroute("**/api/world*");
    await expectFiveTools(pageA, pageB);

    const questTitle = `OpenQuest workflow ${testInfo.workerIndex} ${crypto.randomUUID()}`;
    await pageA.getByText("CREATE A QUEST", { exact: true }).click();
    await pageA.getByLabel("Title", { exact: true }).fill(questTitle);
    await pageA.getByLabel("Goal", { exact: true }).fill(
      "Prove that humans set direction while other sessions move public work forward.",
    );
    await pageA.getByLabel("Description", { exact: true }).fill(
      "Everything in this test Quest is deliberately public and non-confidential.",
    );
    await pageA.getByRole("button", { exact: true, name: "Create Quest" }).click();
    await expect(pageA).toHaveURL(/\/q\/[a-z0-9-]+$/);
    await expect(pageA.getByRole("heading", { name: questTitle })).toBeVisible();
    await expect(pageA.getByTestId("activity-list")).toContainText(`New Quest: ${questTitle}`);
    await expectFiveTools(pageA, pageB);

    const observed = await successfulTool(
      pageB,
      { name: "openquest_observe", input: {} },
      ObserveResponseSchema,
    );
    expect(observed).not.toHaveProperty("challenges");
    const quest = observed.quests.find((candidate) => candidate.title === questTitle);
    expect(quest).toBeDefined();
    if (!quest) throw new Error("Human-created Quest was absent from public observation.");

    const challengeTitle = `Cross-session Challenge ${crypto.randomUUID()}`;
    const notificationsBeforeChallenge = await mutationNotifications(pageB);
    const challenge = await successfulTool(
      pageB,
      {
        name: "openquest_propose",
        input: {
          description: "Produce a bounded public result that a different browser session can check.",
          kind: "challenge",
          quest_id: quest.id,
          title: challengeTitle,
        },
      },
      CreateChallengeResponseSchema,
    );
    expect(challenge.challenge_status).toBe("open");
    expect(await mutationNotifications(pageB)).toBe(notificationsBeforeChallenge + 1);
    const scopedObservation = await successfulTool(
      pageB,
      { name: "openquest_observe", input: { quest_id: quest.id } },
      ObserveResponseSchema,
    );
    expect(scopedObservation.challenges).toBeInstanceOf(Array);
    expect(scopedObservation.challenges?.some((candidate) => candidate.id === challenge.challenge_id))
      .toBe(true);
    await expect(challengeRow(pageA, challengeTitle)).toHaveAttribute("data-state", "open", {
      timeout: 10_000,
    });
    await expectFiveTools(pageA, pageB);

    const work = await successfulTool(
      pageA,
      { name: "openquest_next", input: { mode: "contribute", quest_id: quest.id } },
      GetNextWorkResponseSchema,
    );
    expect(work).toMatchObject({ status: "work_available", work_type: "contribute" });
    if (work.status !== "work_available" || work.work_type !== "contribute") {
      throw new Error("Expected scoped Contribution work.");
    }
    expect(work.challenge.id).toBe(challenge.challenge_id);

    const contributionSummary = "A bounded result ready for cross-session Review.";
    const submitted = await successfulTool(
      pageA,
      {
        name: "openquest_submit",
        input: {
          challenge_id: challenge.challenge_id,
          content: "Verified public result.\n\nThe preserved whitespace is intentional.",
          evidence: [{ title: "Public evidence", url: "https://example.com/public-evidence" }],
          summary: contributionSummary,
        },
      },
      SubmitContributionResponseSchema,
    );
    expect(submitted.challenge_status).toBe("awaiting_review");
    await expect(pageA.getByTestId("activity-list")).toContainText(`Contribution submitted: ${challengeTitle}`);

    const notificationsBeforeSelfReview = await mutationNotifications(pageA);
    const selfReviewError = await domainErrorTool(
      pageA,
      {
        name: "openquest_review",
        input: {
          contribution_id: submitted.contribution_id,
          reason: "This must be rejected because this session submitted the work.",
          verdict: "support",
        },
      },
      "self_review_forbidden",
    );
    expect(selfReviewError.next_action?.tool).toBe("openquest_next");
    expect(await mutationNotifications(pageA)).toBe(notificationsBeforeSelfReview);
    await expectFiveTools(pageA, pageB);

    const automaticReview = await successfulTool(
      pageB,
      { name: "openquest_next", input: { quest_id: quest.id } },
      GetNextWorkResponseSchema,
    );
    expect(automaticReview).toMatchObject({ status: "work_available", work_type: "review" });
    if (automaticReview.status !== "work_available" || automaticReview.work_type !== "review") {
      throw new Error("Default routing did not prefer Review.");
    }
    expect(automaticReview.contribution.id).toBe(submitted.contribution_id);

    const supported = await successfulTool(
      pageB,
      {
        name: "openquest_review",
        input: {
          contribution_id: submitted.contribution_id,
          reason: "A separate browser session confirmed the public result.",
          verdict: "support",
        },
      },
      ReviewContributionResponseSchema,
    );
    expect(supported.challenge_status).toBe("resolved");
    // This suite uses the disposable Vite/D1 harness, where the live socket deliberately
    // degrades before its immediate fallback invalidation. The dedicated e2e:live suite
    // verifies the real Worker WebSocket path.
    await expect(challengeRow(pageA, challengeTitle)).toHaveAttribute("data-state", "resolved", {
      timeout: 15_000,
    });
    const contributionDetailResponse = await pageA.request.get(
      `/api/contributions/${submitted.contribution_id}`,
    );
    expect(contributionDetailResponse.status()).toBe(200);
    const contributionDetail = ContributionResponseSchema.parse(
      await contributionDetailResponse.json(),
    );
    expect(contributionDetail.review).toMatchObject({
      id: supported.review_id,
      verdict: "support",
    });
    expect(contributionDetail).not.toHaveProperty("reviews");
    await expectFiveTools(pageA, pageB);

    const reopenedChallenge = await successfulTool(
      pageB,
      {
        name: "openquest_propose",
        input: {
          description: "Exercise the append-first challenging Review path and preserve prior public work.",
          kind: "challenge",
          quest_id: quest.id,
          title: `Challenge verdict path ${crypto.randomUUID()}`,
        },
      },
      CreateChallengeResponseSchema,
    );
    const reopenedContribution = await successfulTool(
      pageA,
      {
        name: "openquest_submit",
        input: {
          challenge_id: reopenedChallenge.challenge_id,
          content: "This result needs stronger supporting evidence.",
          summary: "A deliberately incomplete public result.",
        },
      },
      SubmitContributionResponseSchema,
    );
    const challenged = await successfulTool(
      pageB,
      {
        name: "openquest_review",
        input: {
          contribution_id: reopenedContribution.contribution_id,
          reason: "The conclusion is not yet supported by evidence.",
          verdict: "challenge",
        },
      },
      ReviewContributionResponseSchema,
    );
    expect(challenged.challenge_status).toBe("open");
    await expect(pageA.getByTestId("activity-list")).toContainText("Reopened:", {
      timeout: 15_000,
    });
    await expectFiveTools(pageA, pageB);

    const agentQuest = await successfulTool(
      pageB,
      {
        name: "openquest_propose",
        input: {
          description: "This Quest should become public immediately without approval.",
          goal: "Publish a new open problem directly through the agent participation layer.",
          kind: "quest",
          title: `Agent-created Quest ${crypto.randomUUID()}`,
        },
      },
      CreateQuestResponseSchema,
    );
    expect(agentQuest.quest_status).toBe("active");
    const observedAgentQuest = await successfulTool(
      pageA,
      { name: "openquest_observe", input: {} },
      ObserveResponseSchema,
    );
    expect(observedAgentQuest.quests.some((candidate) => candidate.id === agentQuest.quest_id)).toBe(true);
    await expectFiveTools(pageA, pageB);
  } finally {
    await sessionA.close();
    await sessionB.close();
  }
});
