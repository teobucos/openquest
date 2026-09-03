import { z } from "zod";

// Fixture v2 verifier: asserts the exact deterministic demo world produced by
// demo/reset.sql followed by demo/seed.sql (see demo/expected-state.json).
//
// Checks: org/quest counts and pairs, is_demo + unverified + no-ROR
// provenance, Challenge state counts, Contribution/Review status counts,
// reopened history, Demo Agent contributor count, exactly 59 public events
// with a contiguous 1..59 sequence, no leftover v1 fixture rows, and the two
// deterministic work-selection targets (oldest pending Review is the
// Northstar cooling rubric; oldest Arcfield open is the reproducibility
// fields Challenge). Fails loudly on any mismatch.

const servePersistPath = process.env.OPENQUEST_PERSIST_PATH?.trim() || ".runtime/state";
const targetArguments = {
  local: ["--local"],
  remote: ["--remote"],
  serve: ["--local", "--persist-to", servePersistPath],
};

const assertionQuery = `
  SELECT
    (SELECT COUNT(*) FROM organizations
      WHERE id GLOB 'demo_org_*'
        AND is_demo = 1
        AND verification_status = 'unverified'
        AND ror_id IS NULL) AS organizations,
    (SELECT COUNT(*) FROM quests
      WHERE id GLOB 'demo_quest_*') AS quests,
    (SELECT COUNT(*) FROM quests
      WHERE id GLOB 'demo_quest_*'
        AND is_demo = 1) AS demo_quests,
    (SELECT COUNT(*) FROM quests q JOIN organizations o ON o.id = q.primary_organization_id
      WHERE (o.id, q.id) IN (
        ('demo_org_arcfield', 'demo_quest_repro'),
        ('demo_org_northstar', 'demo_quest_heat'),
        ('demo_org_openrelay', 'demo_quest_crisis'),
        ('demo_org_commonlight', 'demo_quest_stem'),
        ('demo_org_mosaic', 'demo_quest_prov'))) AS organization_quests,
    (SELECT COUNT(*) FROM organizations
      WHERE id GLOB 'demo_org_*'
        AND (verification_status = 'verified' OR ror_id IS NOT NULL)) AS bad_provenance,
    (SELECT COUNT(*) FROM quests
      WHERE id GLOB 'demo_quest_*'
        AND (is_demo = 0 OR primary_organization_id IS NULL
          OR primary_organization_id NOT GLOB 'demo_org_*')) AS bad_quests,
    (SELECT COUNT(*) FROM (SELECT primary_organization_id FROM quests
      WHERE id GLOB 'demo_quest_*' GROUP BY primary_organization_id
      HAVING COUNT(*) <> 1)) AS orgs_not_single_quest,
    (SELECT COUNT(*) FROM challenges
      WHERE id GLOB 'demo_challenge_*'
        AND status = 'awaiting_review') AS awaiting_review,
    (SELECT COUNT(*) FROM challenges
      WHERE id GLOB 'demo_challenge_*'
        AND status = 'open') AS open,
    (SELECT COUNT(*) FROM challenges
      WHERE id GLOB 'demo_challenge_*'
        AND status = 'resolved') AS resolved,
    (SELECT COUNT(*) FROM contributions
      WHERE status = 'pending'
        AND challenge_id GLOB 'demo_challenge_*') AS contributions_pending,
    (SELECT COUNT(*) FROM contributions
      WHERE status = 'accepted'
        AND challenge_id GLOB 'demo_challenge_*') AS contributions_accepted,
    (SELECT COUNT(*) FROM contributions
      WHERE status = 'challenged'
        AND challenge_id GLOB 'demo_challenge_*') AS contributions_challenged,
    (SELECT COUNT(*) FROM reviews WHERE verdict = 'support'
      AND contribution_id IN (SELECT id FROM contributions
        WHERE challenge_id GLOB 'demo_challenge_*')) AS reviews_support,
    (SELECT COUNT(*) FROM reviews WHERE verdict = 'challenge'
      AND contribution_id IN (SELECT id FROM contributions
        WHERE challenge_id GLOB 'demo_challenge_*')) AS reviews_challenge,
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
      WHERE quest_id GLOB 'demo_quest_*') AS public_events,
    (SELECT COUNT(*) FROM events
      WHERE quest_id GLOB 'demo_quest_*'
        AND event_type = 'quest.created') AS quest_created,
    (SELECT COUNT(*) FROM events
      WHERE quest_id GLOB 'demo_quest_*'
        AND event_type = 'challenge.created') AS challenge_created,
    (SELECT COUNT(*) FROM events
      WHERE quest_id GLOB 'demo_quest_*'
        AND event_type = 'contribution.created') AS contribution_created,
    (SELECT COUNT(*) FROM events
      WHERE quest_id GLOB 'demo_quest_*'
        AND event_type = 'review.supported') AS review_supported,
    (SELECT COUNT(*) FROM events
      WHERE quest_id GLOB 'demo_quest_*'
        AND event_type = 'review.challenged') AS review_challenged,
    (SELECT COALESCE(MIN(sequence), 0) FROM events
      WHERE quest_id GLOB 'demo_quest_*') AS sequence_first,
    (SELECT COALESCE(MAX(sequence), 0) FROM events
      WHERE quest_id GLOB 'demo_quest_*') AS sequence_last,
    (SELECT h.title FROM contributions c JOIN challenges h ON h.id = c.challenge_id
      WHERE c.status = 'pending' AND h.status = 'awaiting_review'
      ORDER BY c.created_at ASC, c.id ASC LIMIT 1) AS oldest_review_title,
    (SELECT h.id FROM contributions c JOIN challenges h ON h.id = c.challenge_id
      WHERE c.status = 'pending' AND h.status = 'awaiting_review'
      ORDER BY c.created_at ASC, c.id ASC LIMIT 1) AS oldest_review_challenge,
    (SELECT h.title FROM challenges h JOIN quests q ON q.id = h.quest_id
      WHERE q.id = 'demo_quest_repro' AND h.status = 'open'
      ORDER BY h.created_at ASC, h.id ASC LIMIT 1) AS arcfield_open_title,
    (SELECT h.id FROM challenges h JOIN quests q ON q.id = h.quest_id
      WHERE q.id = 'demo_quest_repro' AND h.status = 'open'
      ORDER BY h.created_at ASC, h.id ASC LIMIT 1) AS arcfield_open_challenge,
    (SELECT COUNT(*) FROM quests WHERE id = 'demo_quest_tide') AS legacy_tide,
    (SELECT COUNT(*) FROM organizations WHERE id GLOB 'demo_org_*'
      AND name IN ('Lattice Field Station', 'Moonwater Learning Lab',
        'Northwind Civic Studio', 'Orbit Public Works')) AS legacy_orgs
`;

const DemoAssertionsSchema = z.strictObject({
  arcfield_open_challenge: z.string(),
  arcfield_open_title: z.string(),
  awaiting_review: z.number().int(),
  bad_provenance: z.number().int(),
  bad_quests: z.number().int(),
  challenge_created: z.number().int(),
  contributors: z.number().int(),
  contribution_created: z.number().int(),
  contributions_accepted: z.number().int(),
  contributions_challenged: z.number().int(),
  contributions_pending: z.number().int(),
  demo_quests: z.number().int(),
  legacy_orgs: z.number().int(),
  legacy_tide: z.number().int(),
  oldest_review_challenge: z.string(),
  oldest_review_title: z.string(),
  open: z.number().int(),
  organization_quests: z.number().int(),
  organizations: z.number().int(),
  orgs_not_single_quest: z.number().int(),
  public_events: z.number().int(),
  quest_created: z.number().int(),
  quests: z.number().int(),
  reopened_history: z.number().int(),
  resolved: z.number().int(),
  review_challenged: z.number().int(),
  review_supported: z.number().int(),
  reviews_challenge: z.number().int(),
  reviews_support: z.number().int(),
  sequence_first: z.number().int(),
  sequence_last: z.number().int(),
});

const WranglerResponseSchema = z
  .array(
    z.looseObject({
      results: z.array(DemoAssertionsSchema).length(1),
      success: z.literal(true),
    }),
  )
  .length(1);

const expectedAssertions = {
  arcfield_open_challenge: "demo_challenge_repro_01",
  arcfield_open_title: "Define minimum reproducibility fields for organoid assay reports",
  awaiting_review: 5,
  bad_provenance: 0,
  bad_quests: 0,
  challenge_created: 25,
  contributors: 12,
  contribution_created: 17,
  contributions_accepted: 10,
  contributions_challenged: 2,
  contributions_pending: 5,
  demo_quests: 5,
  legacy_orgs: 0,
  legacy_tide: 0,
  oldest_review_challenge: "demo_challenge_heat_03",
  oldest_review_title: "Draft a transparent cooling-intervention comparison rubric",
  open: 10,
  organization_quests: 5,
  organizations: 5,
  orgs_not_single_quest: 0,
  public_events: 59,
  quest_created: 5,
  quests: 5,
  reopened_history: 2,
  resolved: 10,
  review_challenged: 2,
  review_supported: 10,
  reviews_challenge: 2,
  reviews_support: 10,
  sequence_first: 1,
  sequence_last: 59,
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
      `Demo seed assertion failed for ${name}: expected ${JSON.stringify(expectedAssertions[name])}, received ${JSON.stringify(observed[name])}.`,
    );
  }
}

console.log(`Demo seed verified for ${target} (fixture v2: 5 orgs, 5 quests, 10 open, 5 awaiting review, 10 resolved, 12 contributors, 59 events #1-#59).`);
