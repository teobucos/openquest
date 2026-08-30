import { expect, test } from "@playwright/test";
import {
  CreateChallengeResponseSchema,
  CreateQuestResponseSchema,
  GetNextWorkResponseSchema,
  ObserveResponseSchema,
  ReviewContributionResponseSchema,
  SubmitContributionResponseSchema,
  WebMCPToolInputJsonSchemas,
} from "../src/contracts";
import {
  abortRegisteredTools,
  cancelledTool,
  challengeRow,
  failedTool,
  installFakeWebMcp,
  registeredTools,
  successfulTool,
} from "./helpers";

test("OpenQuest coordinates public work through native-style WebMCP tools", async ({ browser }, testInfo) => {
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

    const tools = await registeredTools(pageA);
    expect(tools.map((tool) => ({ name: tool.name, title: tool.title }))).toEqual([
      { name: "openquest_next", title: "Get useful work" },
      { name: "openquest_observe", title: "Observe OpenQuest" },
      { name: "openquest_propose", title: "Propose work" },
      { name: "openquest_review", title: "Review contribution" },
      { name: "openquest_submit", title: "Submit contribution" },
    ]);
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.description.length).toBeLessThan(400);
      expect(tool.inputSchema).toEqual(WebMCPToolInputJsonSchemas[tool.name]);
    }
    await expect(pageA.getByText("5 Site Tools ready", { exact: true })).toBeVisible();

    const cancelled = await cancelledTool(pageA, {
      name: "openquest_observe",
      input: {},
    });
    expect(cancelled).toMatchObject({ ok: false });

    const questTitle = `OpenQuest workflow ${testInfo.workerIndex} ${crypto.randomUUID()}`;
    await pageA.getByLabel("Title", { exact: true }).fill(questTitle);
    await pageA.getByLabel("Goal", { exact: true }).fill(
      "Prove that humans set direction while independent sessions move public work forward.",
    );
    await pageA.getByLabel("Description", { exact: true }).fill(
      "Everything in this test Quest is deliberately public and non-confidential.",
    );
    await pageA.getByRole("button", { exact: true, name: "Create Quest" }).click();
    await expect(pageA).toHaveURL(/\/q\/[a-z0-9-]+$/);
    await expect(pageA.getByRole("heading", { exact: true, name: questTitle })).toBeVisible();
    await expect(pageA.getByTestId("activity-list")).toContainText(`New Quest: ${questTitle}`);

    const observed = await successfulTool(
      pageB,
      { name: "openquest_observe", input: {} },
      ObserveResponseSchema,
    );
    const quest = observed.quests.find((candidate) => candidate.title === questTitle);
    expect(quest).toBeDefined();
    if (!quest) throw new Error("Human-created Quest was absent from public observation.");

    const challengeTitle = `Cross-session Challenge ${crypto.randomUUID()}`;
    const challenge = await successfulTool(
      pageB,
      {
        name: "openquest_propose",
        input: {
          description: "Produce a bounded public result that a different browser session can independently check.",
          kind: "challenge",
          quest_id: quest.id,
          title: challengeTitle,
        },
      },
      CreateChallengeResponseSchema,
    );
    expect(challenge.challenge_status).toBe("open");
    await expect(challengeRow(pageA, challengeTitle)).toHaveAttribute("data-status", "open");

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

    const submitted = await successfulTool(
      pageA,
      {
        name: "openquest_submit",
        input: {
          challenge_id: challenge.challenge_id,
          content: "Verified public result.\n\nThe preserved whitespace is intentional.",
          evidence: [{ title: "Public evidence", url: "https://example.com/public-evidence" }],
          summary: "A bounded result ready for independent Review.",
        },
      },
      SubmitContributionResponseSchema,
    );
    expect(submitted.challenge_status).toBe("awaiting_review");

    const selfReviewError = await failedTool(pageA, {
      name: "openquest_review",
      input: {
        contribution_id: submitted.contribution_id,
        reason: "This must be rejected because this session submitted the work.",
        verdict: "support",
      },
    });
    expect(selfReviewError).toContain("[self_review_forbidden]");

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
          reason: "A separate browser session independently confirmed the public result.",
          verdict: "support",
        },
      },
      ReviewContributionResponseSchema,
    );
    expect(supported.challenge_status).toBe("resolved");
    await expect(challengeRow(pageA, challengeTitle)).toHaveAttribute("data-status", "resolved");

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
    await expect(pageA.getByTestId("activity-list")).toContainText("Reopened:");

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

    await abortRegisteredTools(pageA);
    await expect.poll(() => registeredTools(pageA)).toEqual([]);
  } finally {
    await sessionA.close();
    await sessionB.close();
  }
});
