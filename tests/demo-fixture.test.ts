import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";

const expectedState = await Bun.file("demo/expected-state.json").json();
const seed = await Bun.file("demo/seed.sql").text();
const reset = await Bun.file("demo/reset.sql").text();
const migrations = [
  "migrations/0001_initial.sql",
  "migrations/0002_challenges_by_status_created_id.sql",
  "migrations/0003_live_domain_foundation.sql",
  "migrations/0004_organization_ror_and_projection_indexes.sql",
  "migrations/0005_quest_demo_provenance.sql",
];

test("the demo fixture declares its v2 submission network state", () => {
  expect(expectedState.fixture_version).toBe(2);
  expect(expectedState.organizations).toBe(5);
  expect(expectedState.quests).toBe(5);
  expect(expectedState.demo_quests).toBe(5);
  expect(expectedState.contributors).toBe(12);
  expect(expectedState.open).toBe(10);
  expect(expectedState.awaiting_review).toBe(5);
  expect(expectedState.resolved).toBe(10);
  expect(expectedState.reopened_history).toBe(2);
  expect(expectedState.public_events).toBe(59);
  expect(expectedState.contributions).toEqual({ accepted: 10, challenged_retained: 2, pending: 5 });
  expect(expectedState.reviews).toEqual({ challenging: 2, supporting: 10 });

  expect(seed).toContain("demo_org_arcfield");
  expect(seed).toContain("demo_quest_heat");
  expect(seed).toContain("demo_quest_crisis");
  expect(seed).toContain("demo_challenge_repro_01");
  expect(seed).toContain("demo_contribution_reopened_01");
  expect(seed).toContain("demo_review_challenge_02");
  expect(seed).toContain("is_demo");
  expect(seed).toContain("unverified");
  expect(seed).not.toContain("INSERT INTO events");
  expect(seed).not.toContain("demo_quest_tide");
  expect(seed).not.toContain("Lattice Field Station");

  expect(reset).toContain("DELETE FROM reviews;");
  expect(reset).toContain("DELETE FROM sessions;");
  expect(reset).toContain("DELETE FROM sqlite_sequence WHERE name = 'events';");
  expect(reset).not.toContain("DROP TABLE");
  expect(reset).not.toContain("DROP TRIGGER");
});

test("reset plus seed produces the planned v2 network through the real triggers", async () => {
  const database = new Database(":memory:");
  try {
    for (const migration of migrations) {
      database.exec(await Bun.file(migration).text());
    }
    database.exec(reset);
    database.exec(seed);

    const count = (sql: string): number =>
      (database.query(sql).get() as { count: number }).count;

    expect(count("SELECT COUNT(*) AS count FROM organizations WHERE is_demo = 1")).toBe(5);
    expect(count("SELECT COUNT(*) AS count FROM organizations WHERE verification_status = 'verified' OR ror_id IS NOT NULL")).toBe(0);
    expect(count("SELECT COUNT(*) AS count FROM quests WHERE id GLOB 'demo_quest_*' AND is_demo = 1")).toBe(5);
    expect(count("SELECT COUNT(*) AS count FROM quests WHERE id GLOB 'demo_quest_*' AND (primary_organization_id IS NULL OR primary_organization_id NOT GLOB 'demo_org_*')")).toBe(0);
    expect(
      count("SELECT COUNT(*) AS count FROM challenges WHERE id GLOB 'demo_challenge_*' AND status = 'awaiting_review'"),
    ).toBe(5);
    expect(count("SELECT COUNT(*) AS count FROM challenges WHERE id GLOB 'demo_challenge_*' AND status = 'open'")).toBe(10);
    expect(count("SELECT COUNT(*) AS count FROM challenges WHERE id GLOB 'demo_challenge_*' AND status = 'resolved'")).toBe(10);
    expect(count("SELECT COUNT(*) AS count FROM contributions WHERE status = 'pending'")).toBe(5);
    expect(count("SELECT COUNT(*) AS count FROM contributions WHERE status = 'accepted'")).toBe(10);
    expect(
      count("SELECT COUNT(*) AS count FROM contributions WHERE id GLOB 'demo_contribution_reopened_*' AND status = 'challenged'"),
    ).toBe(2);
    expect(count("SELECT COUNT(*) AS count FROM reviews WHERE verdict = 'support'")).toBe(10);
    expect(count("SELECT COUNT(*) AS count FROM reviews WHERE verdict = 'challenge'")).toBe(2);
    expect(count("SELECT COUNT(*) AS count FROM events WHERE quest_id GLOB 'demo_quest_*'")).toBe(59);

    expect(
      database.query("SELECT event_type AS type, COUNT(*) AS count FROM events GROUP BY event_type ORDER BY event_type").all(),
    ).toEqual([
      { count: 25, type: "challenge.created" },
      { count: 17, type: "contribution.created" },
      { count: 5, type: "quest.created" },
      { count: 2, type: "review.challenged" },
      { count: 10, type: "review.supported" },
    ]);
    expect(database.query("SELECT MIN(sequence) AS first, MAX(sequence) AS last FROM events").get()).toEqual({
      first: 1,
      last: 59,
    });
    expect(
      count("SELECT COUNT(*) AS count FROM (SELECT sequence FROM events GROUP BY sequence HAVING COUNT(*) > 1)"),
    ).toBe(0);
    expect(
      count(`SELECT COUNT(DISTINCT actor_session_id) AS count FROM events
        WHERE quest_id GLOB 'demo_quest_*'
          AND event_type IN ('challenge.created', 'contribution.created', 'review.supported', 'review.challenged')`),
    ).toBe(12);

    // Each organization owns exactly one Quest, with the expected pairing.
    expect(
      database.query("SELECT id AS org, (SELECT id FROM quests WHERE primary_organization_id = organizations.id) AS quest FROM organizations WHERE id GLOB 'demo_org_*' ORDER BY id").all(),
    ).toEqual([
      { org: "demo_org_arcfield", quest: "demo_quest_repro" },
      { org: "demo_org_commonlight", quest: "demo_quest_stem" },
      { org: "demo_org_mosaic", quest: "demo_quest_prov" },
      { org: "demo_org_northstar", quest: "demo_quest_heat" },
      { org: "demo_org_openrelay", quest: "demo_quest_crisis" },
    ]);

    // Deterministic routing: oldest pending Review is the Northstar rubric;
    // oldest Arcfield open is the reproducibility-fields Challenge.
    expect(
      database.query("SELECT h.id AS id, h.title AS title FROM contributions c JOIN challenges h ON h.id = c.challenge_id WHERE c.status = 'pending' AND h.status = 'awaiting_review' ORDER BY c.created_at ASC, c.id ASC LIMIT 1").get(),
    ).toEqual({
      id: "demo_challenge_heat_03",
      title: "Draft a transparent cooling-intervention comparison rubric",
    });
    expect(
      database.query("SELECT h.id AS id, h.title AS title FROM challenges h JOIN quests q ON q.id = h.quest_id WHERE q.id = 'demo_quest_repro' AND h.status = 'open' ORDER BY h.created_at ASC, h.id ASC LIMIT 1").get(),
    ).toEqual({
      id: "demo_challenge_repro_01",
      title: "Define minimum reproducibility fields for organoid assay reports",
    });

    // Both reopen histories keep a challenged Contribution plus an accepted one.
    expect(
      database.query("SELECT challenge_id AS challenge, status FROM contributions WHERE challenge_id IN ('demo_challenge_repro_05', 'demo_challenge_prov_04') ORDER BY challenge_id, created_at").all(),
    ).toEqual([
      { challenge: "demo_challenge_prov_04", status: "challenged" },
      { challenge: "demo_challenge_prov_04", status: "accepted" },
      { challenge: "demo_challenge_repro_05", status: "challenged" },
      { challenge: "demo_challenge_repro_05", status: "accepted" },
    ]);

    // The final activity window spans all five Quests.
    expect(
      database.query("SELECT COUNT(DISTINCT quest_id) AS count FROM (SELECT quest_id FROM events ORDER BY sequence DESC LIMIT 20)").get(),
    ).toEqual({ count: 5 });

    // Legacy migration rows and the v1 fixture are gone.
    expect(count("SELECT COUNT(*) AS count FROM quests WHERE id IN ('quest_open_cancer_research', 'demo_quest_tide')")).toBe(0);
  } finally {
    database.close();
  }
});
