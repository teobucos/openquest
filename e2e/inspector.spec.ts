import { expect, test } from "@playwright/test";
import {
  CreateChallengeResponseSchema,
  CreateQuestResponseSchema,
  ReviewContributionResponseSchema,
  SubmitContributionResponseSchema,
} from "../src/contracts";

test("the Challenge inspector renders public pending, Result, and challenged history safely", async ({ browser }) => {
  const author = await browser.newContext({
    extraHTTPHeaders: { "cf-connecting-ip": `e2e-inspector-author-${crypto.randomUUID()}` },
  });
  const reviewer = await browser.newContext({
    extraHTTPHeaders: { "cf-connecting-ip": `e2e-inspector-reviewer-${crypto.randomUUID()}` },
  });
  const page = await author.newPage();
  let questId = "";

  async function createChallenge(title: string, description: string) {
    const response = await page.request.post("/api/challenges", {
      data: { description, quest_id: questId, title },
    });
    expect(response.status()).toBe(201);
    return CreateChallengeResponseSchema.parse(await response.json());
  }

  async function submit(challengeId: string, summary: string, content: string, evidence: Array<{ title: string; url: string }>) {
    const response = await page.request.post("/api/contributions", {
      data: { challenge_id: challengeId, content, evidence, summary },
    });
    expect(response.status()).toBe(201);
    return SubmitContributionResponseSchema.parse(await response.json());
  }

  async function review(contributionId: string, verdict: "challenge" | "support", reason: string, evidence: Array<{ title: string; url: string }>) {
    const response = await reviewer.request.post("/api/reviews", {
      data: { contribution_id: contributionId, evidence, reason, verdict },
    });
    expect(response.status()).toBe(201);
    return ReviewContributionResponseSchema.parse(await response.json());
  }

  try {
    await page.goto("/");
    const questResponse = await page.request.post("/api/quests", {
      data: {
        description: "A deterministic Quest used to inspect every public Contribution outcome.",
        goal: "Exercise pending, supported, and challenged public Challenge history in the human inspector.",
        title: `Inspector history ${crypto.randomUUID()}`,
      },
    });
    expect(questResponse.status()).toBe(201);
    const quest = CreateQuestResponseSchema.parse(await questResponse.json());
    questId = quest.quest_id;

    const adversarial = `<script>window.__openquestInspectorPayloadExecuted = true</script>`;
    const pendingChallenge = await createChallenge(
      `Pending ${adversarial}`,
      `Render ${adversarial} as public text, never executable markup.`,
    );
    await submit(
      pendingChallenge.challenge_id,
      `Pending evidence ${adversarial}`,
      `Pending public detail ${adversarial}`,
      [{ title: "Pending HTTPS evidence", url: "https://example.com/pending-evidence" }],
    );

    await page.goto(`/q/${quest.slug}?challenge=${pendingChallenge.challenge_id}`);
    const inspector = page.getByRole("dialog", { name: "Challenge inspector" });
    await expect(inspector).toBeVisible();
    await expect(inspector.getByText(`Pending ${adversarial}`, { exact: true })).toBeVisible();
    await expect(inspector.getByText(`Pending public detail ${adversarial}`, { exact: true })).toBeVisible();
    await expect(inspector.getByText("AWAITING REVIEW", { exact: true })).toBeVisible();
    const pendingEvidence = inspector.getByRole("link", { name: "Pending HTTPS evidence ↗" });
    await expect(pendingEvidence).toHaveAttribute("href", "https://example.com/pending-evidence");
    await expect(pendingEvidence).toHaveAttribute("target", "_blank");
    await expect(pendingEvidence).toHaveAttribute("rel", "noopener noreferrer");
    await expect(inspector.locator("img, script")).toHaveCount(0);
    expect(await page.evaluate(() => (
      window as typeof window & { __openquestInspectorPayloadExecuted?: boolean }
    ).__openquestInspectorPayloadExecuted === true)).toBe(false);

    const supportedChallenge = await createChallenge(
      `Supported detail ${crypto.randomUUID()}`,
      "Show a supported Contribution and its full public Review record in the Challenge inspector.",
    );
    const supportedContribution = await submit(
      supportedChallenge.challenge_id,
      "Supported public Contribution",
      "The full supported Contribution is preserved in the inspector as the Result.",
      [{ title: "Contribution evidence", url: "https://example.com/contribution-evidence" }],
    );
    await review(
      supportedContribution.contribution_id,
      "support",
      "The independent reviewer confirmed the public Result.",
      [{ title: "Support review evidence", url: "https://example.com/support-review-evidence" }],
    );

    await page.goto(`/q/${quest.slug}?challenge=${supportedChallenge.challenge_id}`);
    await expect(inspector.getByText("RESULT", { exact: true })).toBeVisible();
    await expect(inspector.getByRole("heading", { name: "Supported public Contribution" })).toBeVisible();
    await expect(inspector.getByText("The full supported Contribution is preserved in the inspector as the Result.", { exact: true })).toBeVisible();
    await expect(inspector.getByText("SUPPORTED REVIEW", { exact: true })).toBeVisible();
    await expect(inspector.getByText("The independent reviewer confirmed the public Result.", { exact: true })).toBeVisible();
    await expect(inspector.getByRole("link", { name: "Support review evidence ↗" })).toHaveAttribute("rel", "noopener noreferrer");

    const challengedChallenge = await createChallenge(
      `Challenged detail ${crypto.randomUUID()}`,
      "Keep a challenged Contribution in chronological public Challenge history after reopening the Challenge.",
    );
    const challengedContribution = await submit(
      challengedChallenge.challenge_id,
      "Challenged public Contribution",
      "This historically retained Contribution needs a correction before it can become a Result.",
      [],
    );
    await review(
      challengedContribution.contribution_id,
      "challenge",
      "The cited record is incomplete, so the Challenge must reopen for better public work.",
      [{ title: "Challenge review evidence", url: "https://example.com/challenge-review-evidence" }],
    );

    await page.goto(`/q/${quest.slug}?challenge=${challengedChallenge.challenge_id}`);
    await expect(inspector.getByText("CHALLENGED", { exact: true })).toBeVisible();
    await expect(inspector.getByText("CHALLENGING REVIEW", { exact: true })).toBeVisible();
    await expect(inspector.getByText("The cited record is incomplete, so the Challenge must reopen for better public work.", { exact: true })).toBeVisible();
    await expect(inspector.getByRole("link", { name: "Challenge review evidence ↗" })).toHaveAttribute("href", "https://example.com/challenge-review-evidence");
  } finally {
    await author.close();
    await reviewer.close();
  }
});
