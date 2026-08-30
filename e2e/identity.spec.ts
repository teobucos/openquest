import { expect, test } from "@playwright/test";
import { Database } from "bun:sqlite";
import { readdirSync } from "node:fs";
import {
  ContributionResponseSchema,
  CreateChallengeResponseSchema,
  CreateQuestResponseSchema,
  SubmitContributionResponseSchema,
} from "../src/contracts";

const d1StateDirectory = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";

function sessionCount(): number {
  for (const name of readdirSync(d1StateDirectory)) {
    if (!name.endsWith(".sqlite")) continue;
    const database = new Database(`${d1StateDirectory}/${name}`, { readonly: true });
    const sessionsTable = database
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sessions'",
      )
      .get();
    if (!sessionsTable) {
      database.close();
      continue;
    }
    const row = database
      .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM sessions")
      .get();
    database.close();
    if (!row) throw new Error("Could not count OpenQuest sessions.");
    return row.count;
  }
  throw new Error("Could not find the local OpenQuest D1 database.");
}

test("write limits run before identity creation and public identifiers use eight hex digits", async ({ browser }) => {
  const address = `e2e-identity-${crypto.randomUUID()}`;
  const writer = await browser.newContext({
    extraHTTPHeaders: { "cf-connecting-ip": address },
  });

  try {
    const questResponse = await writer.request.post("/api/quests", {
      data: {
        description: "Verify bounded public identifiers and pre-identity rate limiting.",
        goal: "Prove that OpenQuest avoids unreachable anonymous session rows.",
        title: `Long slug ${"x".repeat(150)}`,
      },
    });
    expect(questResponse.status()).toBe(201);
    const sessionsAfterFirstWrite = sessionCount();
    const quest = CreateQuestResponseSchema.parse(await questResponse.json());
    expect(quest.slug).toMatch(/-[0-9a-f]{8}$/);
    expect(quest.slug).toHaveLength(79);
    expect(quest.slug.slice(0, -9).length).toBeLessThanOrEqual(70);

    const challengeResponse = await writer.request.post("/api/challenges", {
      data: {
        description: "Create a Contribution whose public actor label can be verified.",
        quest_id: quest.quest_id,
        title: "Verify the public Agent label",
      },
    });
    expect(challengeResponse.status()).toBe(201);
    const challenge = CreateChallengeResponseSchema.parse(await challengeResponse.json());

    const contributionResponse = await writer.request.post("/api/contributions", {
      data: {
        challenge_id: challenge.challenge_id,
        content: "The public Agent label contains an eight-hex-character suffix.",
        summary: "Eight-hex Agent label fixture.",
      },
    });
    expect(contributionResponse.status()).toBe(201);
    const contribution = SubmitContributionResponseSchema.parse(await contributionResponse.json());
    const detailResponse = await writer.request.get(
      `/api/contributions/${contribution.contribution_id}`,
    );
    expect(detailResponse.status()).toBe(200);
    const detail = ContributionResponseSchema.parse(await detailResponse.json());
    expect(detail.contribution.actor_label).toMatch(/^Agent [0-9A-F]{8}$/);

    for (let index = 0; index < 27; index += 1) {
      const response = await writer.request.post("/api/quests", {
        data: {
          description: "Consume one write from the same anonymous session and address.",
          goal: "Reach the documented thirty-write limit within one minute.",
          title: `Rate limit fixture ${index} ${crypto.randomUUID()}`,
        },
      });
      expect(response.status()).toBe(201);
    }
    expect(sessionCount()).toBe(sessionsAfterFirstWrite);

    const rejectedWriter = await browser.newContext({
      extraHTTPHeaders: { "cf-connecting-ip": address },
    });
    try {
      const rejectedResponse = await rejectedWriter.request.post("/api/quests", {
        data: {
          description: "This request must be rejected before creating a new session.",
          goal: "Confirm pre-identity IP rate limiting prevents orphan sessions.",
          title: `Rejected rate limit fixture ${crypto.randomUUID()}`,
        },
      });
      expect(rejectedResponse.status()).toBe(429);
      expect(sessionCount()).toBe(sessionsAfterFirstWrite);
    } finally {
      await rejectedWriter.close();
    }
  } finally {
    await writer.close();
  }
});
