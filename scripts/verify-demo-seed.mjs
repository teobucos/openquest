import { z } from "zod";

const targetArguments = {
  local: ["--local"],
  remote: ["--remote"],
  serve: ["--local", "--persist-to", ".runtime/state"],
};

const assertionQuery = `
  SELECT
    (SELECT COUNT(*) FROM organizations
      WHERE id GLOB 'demo_org_*'
        AND is_demo = 1
        AND verification_status = 'unverified') AS organizations,
    (SELECT COUNT(*) FROM quests
      WHERE id GLOB 'demo_quest_*') AS quests,
    (SELECT COUNT(*) FROM quests
      WHERE id GLOB 'demo_quest_*'
        AND primary_organization_id GLOB 'demo_org_*') AS organization_quests,
    (SELECT COUNT(*) FROM challenges
      WHERE id GLOB 'demo_challenge_*'
        AND status = 'awaiting_review') AS awaiting_review,
    (SELECT COUNT(*) FROM challenges
      WHERE id GLOB 'demo_challenge_*'
        AND status = 'open') AS open,
    (SELECT COUNT(*) FROM challenges
      WHERE id GLOB 'demo_challenge_*'
        AND status = 'resolved') AS resolved,
    (SELECT COUNT(DISTINCT actor_session_id) FROM events
      WHERE quest_id GLOB 'demo_quest_*'
        AND event_type IN (
          'challenge.created',
          'contribution.created',
          'review.supported',
          'review.challenged'
        )) AS contributors,
    (SELECT COUNT(*) FROM contributions
      WHERE id GLOB 'demo_contribution_reopened_*'
        AND status = 'challenged') AS reopened_history,
    (SELECT COUNT(*) FROM events
      WHERE quest_id GLOB 'demo_quest_*') AS public_events
`;

const DemoAssertionsSchema = z
  .object({
    awaiting_review: z.number().int(),
    contributors: z.number().int(),
    open: z.number().int(),
    organization_quests: z.number().int(),
    organizations: z.number().int(),
    public_events: z.number().int(),
    quests: z.number().int(),
    reopened_history: z.number().int(),
    resolved: z.number().int(),
  })
  .strict();

const WranglerResponseSchema = z
  .array(
    z
      .object({
        results: z.array(DemoAssertionsSchema).length(1),
        success: z.literal(true),
      })
      .passthrough(),
  )
  .length(1);

const expectedAssertions = {
  awaiting_review: 10,
  contributors: 12,
  open: 15,
  organization_quests: 4,
  organizations: 4,
  public_events: 100,
  quests: 8,
  reopened_history: 3,
  resolved: 17,
};

const target = process.argv[2];
if (!Object.hasOwn(targetArguments, target)) {
  throw new Error("Use one target: local, serve, or remote.");
}

const worker = Bun.spawn(
  [
    "bun",
    "run",
    "--bun",
    "wrangler",
    "d1",
    "execute",
    "openquest",
    ...targetArguments[target],
    "--json",
    "--command",
    assertionQuery,
  ],
  { stderr: "inherit", stdout: "pipe" },
);
const stdout = await new Response(worker.stdout).text();
const exitCode = await worker.exited;
if (exitCode !== 0) {
  throw new Error(`D1 demo verification query failed with exit code ${exitCode}.`);
}

const parsed = WranglerResponseSchema.parse(JSON.parse(stdout));
const observed = parsed[0].results[0];
for (const name of Object.keys(expectedAssertions)) {
  if (observed[name] !== expectedAssertions[name]) {
    throw new Error(
      `Demo seed assertion failed for ${name}: expected ${expectedAssertions[name]}, received ${observed[name]}.`,
    );
  }
}

console.log(`Demo seed verified for ${target}.`);
