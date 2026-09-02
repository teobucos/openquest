import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";

const expectedState = await Bun.file("demo/expected-state.json").json();
const seed = await Bun.file("demo/seed.sql").text();
const initialMigration = await Bun.file("migrations/0001_initial.sql").text();
const queueIndexMigration = await Bun.file("migrations/0002_challenges_by_status_created_id.sql").text();

const organizationMigrationProjection = `
  CREATE TABLE organizations (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    website_url TEXT,
    verification_status TEXT NOT NULL,
    ror_id TEXT,
    is_demo INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  ALTER TABLE quests
    ADD COLUMN primary_organization_id TEXT REFERENCES organizations(id);
  ALTER TABLE quests
    ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1));
`;

test("the demo fixture declares and verifies its bounded organization and work-stream state", () => {
  expect(expectedState).toEqual({
    contributors: 12,
    demo_quests: 8,
    fixture_version: 1,
    id_prefix: "demo_",
    organizations: 4,
    public_events: 100,
    quests: 8,
    reopened_history: 3,
    work_stream: {
      open: 15,
      resolved: 17,
      review: 10,
    },
  });

  expect(seed).toContain("INSERT OR IGNORE INTO organizations");
  expect(seed).toContain("primary_organization_id");
  expect(seed).toContain("verification_status");
  expect(seed).toContain("is_demo");
  expect(seed).toContain("demo_contribution_reopened_01");
  expect(seed).toContain("demo_review_challenge_03");
  expect(seed).not.toContain("verified institute");

});

test("the seed produces the planned D1 work-stream distribution after the organization migration", () => {
  const database = new Database(":memory:");

  try {
    database.exec(initialMigration);
    database.exec(queueIndexMigration);
    database.exec(organizationMigrationProjection);
    database.exec(seed);
    expect(
      database
        .query(
          "SELECT status, COUNT(*) AS count FROM challenges WHERE id GLOB 'demo_challenge_*' GROUP BY status ORDER BY status",
        )
        .all(),
    ).toEqual([
      { count: 10, status: "awaiting_review" },
      { count: 15, status: "open" },
      { count: 17, status: "resolved" },
    ]);
    expect(
      database
        .query("SELECT COUNT(*) AS count FROM events WHERE quest_id GLOB 'demo_quest_*'")
        .get(),
    ).toEqual({ count: 100 });
    expect(
      database
        .query("SELECT COUNT(*) AS count FROM quests WHERE id GLOB 'demo_quest_*' AND is_demo = 1")
        .get(),
    ).toEqual({ count: 8 });
    database.exec("UPDATE quests SET is_demo = 0 WHERE id = 'demo_quest_tide'");
    database.exec(seed);
    expect(database.query("SELECT is_demo FROM quests WHERE id = 'demo_quest_tide'").get()).toEqual({ is_demo: 1 });
  } finally {
    database.close();
  }
});
