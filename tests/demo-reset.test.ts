import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Destructive-reset regression test (spec section 70).
//
// Builds a scratch database in an isolated temp dir containing old-fixture-like
// junk plus live Quests/Contributions/Reviews/sessions/rate-limits, runs the
// reset.sql equivalent (demo/reset.sql when the fixture author has landed it,
// otherwise the inline ordered-delete contract), asserts every application
// table is empty, then seeds demo/seed.sql and asserts the expected fixture
// counts from demo/expected-state.json (supports both fixture v1 and v2
// shapes so the reset regression holds before and after the v2 reland).
//
// Safety: bun:sqlite file in a fresh mkdtemp dir only. Never touches a real
// demo deployment. Skips when the environment indicates a remote target.

const APP_TABLES = [
  "reviews",
  "contributions",
  "events",
  "challenges",
  "quests",
  "organizations",
  "rate_limits",
  "sessions",
] as const;

// Ordered-delete + AUTOINCREMENT-reset contract for demo/reset.sql.
// Used only when demo/reset.sql does not exist yet (fixture lands
// concurrently); the guarded wrapper scripts/reset-demo-world.mjs always
// requires the real demo/reset.sql file.
const RESET_CONTRACT_SQL = `
PRAGMA foreign_keys = OFF;
DELETE FROM reviews;
DELETE FROM contributions;
DELETE FROM events;
DELETE FROM challenges;
DELETE FROM quests;
DELETE FROM organizations;
DELETE FROM rate_limits;
DELETE FROM sessions;
DELETE FROM sqlite_sequence WHERE name = 'events';
PRAGMA foreign_keys = ON;
`;

const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);
const TOKEN_LIVE = "c".repeat(64);

function tableCount(database: Database, table: string): number {
  // Table names come from the fixed APP_TABLES constant above, never user input.
  // SAFETY: bun:sqlite returns a column-named row for this COUNT(*) SELECT.
  const row = database.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  return row.count;
}

function seedJunkWorld(database: Database): void {
  database.exec("PRAGMA foreign_keys = ON;");
  // Old-fixture-like junk: legacy migration rows already exist (0001 seeds
  // quest_open_cancer_research et al.); add stale demo-shaped rows plus live
  // records across every application table.
  database.exec(`
    INSERT INTO sessions (id, token_hash, created_at) VALUES
      ('junk_session_old', '${TOKEN_A}', '2026-01-01T00:00:00.000Z'),
      ('junk_session_live_a', '${TOKEN_B}', '2026-08-01T00:00:00.000Z'),
      ('junk_session_live_b', '${TOKEN_LIVE}', '2026-08-01T00:01:00.000Z');
    INSERT INTO organizations (id, slug, name, description, category, verification_status, ror_id, is_demo, created_at, updated_at) VALUES
      ('junk_org_old', 'junk-org', 'Junk Org', 'Stale pre-reset organization.', 'other', 'unverified', NULL, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    INSERT INTO quests (id, slug, title, goal, description, status, is_demo, primary_organization_id, created_by_session_id, created_at, updated_at) VALUES
      ('demo_quest_tide', 'tide-notes', 'Tide Notes', 'Stale v1 demo quest that the v2 rebuild must remove from the world.', 'Stale.', 'active', 1, NULL, 'junk_session_old', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z'),
      ('junk_quest_live', 'junk-live-quest', 'Junk Live Quest', 'A live test quest that must not survive the demo reset.', 'Live junk.', 'active', 0, 'junk_org_old', 'junk_session_live_a', '2026-08-02T00:00:00.000Z', '2026-08-02T00:00:00.000Z');
    INSERT INTO challenges (id, quest_id, title, description, created_by_session_id, created_at, updated_at) VALUES
      ('junk_challenge_old', 'demo_quest_tide', 'Stale challenge', 'A stale challenge that must not survive the reset.', 'junk_session_old', '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z'),
      ('junk_challenge_live', 'junk_quest_live', 'Live challenge', 'A live challenge that must not survive the reset.', 'junk_session_live_a', '2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z');
    INSERT INTO contributions (id, challenge_id, session_id, summary, content, evidence_json, created_at) VALUES
      ('junk_contribution_old', 'junk_challenge_old', 'junk_session_old', 'Stale contribution.', 'Stale contribution body with enough length to pass checks.', '[]', '2026-01-04T00:00:00.000Z'),
      ('junk_contribution_live', 'junk_challenge_live', 'junk_session_live_b', 'Live contribution.', 'Live contribution body awaiting independent review by another session.', '[]', '2026-08-04T00:00:00.000Z');
    INSERT INTO reviews (id, contribution_id, reviewer_session_id, verdict, reason, evidence_json, created_at) VALUES
      ('junk_review_old', 'junk_contribution_old', 'junk_session_live_a', 'support', 'Stale support review.', '[]', '2026-01-05T00:00:00.000Z');
    INSERT INTO rate_limits (bucket_key, window, request_count) VALUES
      ('junk:bucket:old', 60, 7);
  `);
}

test("destructive demo reset clears the old world, then seed restores the expected fixture", async () => {
  if ((process.env.OPENQUEST_DEMO_TARGET ?? "").toLowerCase() === "remote") {
    console.warn("demo-reset test skipped: OPENQUEST_DEMO_TARGET indicates remote.");
    return;
  }

  const scratchDir = mkdtempSync(join(tmpdir(), "openquest-demo-reset-"));
  const database = new Database(join(scratchDir, "scratch.db"));
  try {
    // Apply the real migration chain: schema, triggers, organizations, is_demo.
    for (const migration of [
      "migrations/0001_initial.sql",
      "migrations/0002_challenges_by_status_created_id.sql",
      "migrations/0003_live_domain_foundation.sql",
      "migrations/0004_organization_ror_and_projection_indexes.sql",
      "migrations/0005_quest_demo_provenance.sql",
    ]) {
      database.exec(await Bun.file(migration).text());
    }

    seedJunkWorld(database);
    expect(tableCount(database, "quests")).toBeGreaterThan(0);
    expect(tableCount(database, "events")).toBeGreaterThan(0);
    expect(tableCount(database, "rate_limits")).toBe(1);

    // Run demo/reset.sql when landed, else the equivalent inline contract.
    const resetSql = existsSync("demo/reset.sql")
      ? await Bun.file("demo/reset.sql").text()
      : RESET_CONTRACT_SQL;
    database.exec(resetSql);

    // After reset: every application table is empty, schema is preserved,
    // and the events AUTOINCREMENT sequence restarts at 1.
    for (const table of APP_TABLES) {
      expect(tableCount(database, table)).toBe(0);
    }
    // SAFETY: bun:sqlite returns column-named rows for this sqlite_master SELECT.
    const tables = (database.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
      (row) => row.name,
    );
    for (const table of APP_TABLES) {
      expect(tables).toContain(table);
    }
    expect(
      // SAFETY: bun:sqlite returns a column-named row for this COUNT(*) SELECT.
      (database.query("SELECT COUNT(*) AS count FROM sqlite_master WHERE type IN ('index', 'trigger')").get() as { count: number }).count,
    ).toBeGreaterThan(0);
    // SAFETY: bun:sqlite returns a column-named row, or null when the sequence row was deleted by the reset.
    const sequence = database.query("SELECT seq FROM sqlite_sequence WHERE name = 'events'").get() as { seq: number } | null;
    expect(sequence === null || sequence.seq === 0).toBe(true);

    // Then seed the fixture and assert the expected state.
    database.exec(await Bun.file("demo/seed.sql").text());
    // SAFETY: demo/expected-state.json is a repo-owned fixture contract with known count fields.
    const expected = (await Bun.file("demo/expected-state.json").json()) as {
      fixture_version: number;
      organizations: number;
      quests: number;
      demo_quests: number;
      contributors: number;
      public_events: number;
      reopened_history: number;
      work_stream?: { open: number; resolved: number; review?: number; awaiting_review?: number };
      open?: number;
      awaiting_review?: number;
      review?: number;
      resolved?: number;
    };
    const workStream = expected.work_stream ?? expected;
    const expectedOpen = workStream.open ?? 0;
    const expectedReview = workStream.awaiting_review ?? workStream.review ?? 0;
    const expectedResolved = workStream.resolved ?? 0;

    const count = (sql: string) =>
      // SAFETY: bun:sqlite returns a column-named row for these COUNT(*) SELECTs.
      (database.query(sql).get() as { count: number }).count;
    expect(count("SELECT COUNT(*) AS count FROM organizations WHERE is_demo = 1")).toBe(expected.organizations);
    expect(count("SELECT COUNT(*) AS count FROM quests WHERE id GLOB 'demo_quest_*'")).toBe(expected.quests);
    expect(count("SELECT COUNT(*) AS count FROM quests WHERE id GLOB 'demo_quest_*' AND is_demo = 1")).toBe(expected.demo_quests);
    expect(count("SELECT COUNT(*) AS count FROM challenges WHERE id GLOB 'demo_challenge_*' AND status = 'open'")).toBe(expectedOpen);
    expect(
      count("SELECT COUNT(*) AS count FROM challenges WHERE id GLOB 'demo_challenge_*' AND status = 'awaiting_review'"),
    ).toBe(expectedReview);
    expect(count("SELECT COUNT(*) AS count FROM challenges WHERE id GLOB 'demo_challenge_*' AND status = 'resolved'")).toBe(
      expectedResolved,
    );
    expect(count("SELECT COUNT(*) AS count FROM events WHERE quest_id GLOB 'demo_quest_*'")).toBe(expected.public_events);
    expect(
      count(
        "SELECT COUNT(*) AS count FROM contributions WHERE id GLOB 'demo_contribution_reopened_*' AND status = 'challenged'",
      ),
    ).toBe(expected.reopened_history);
    expect(
      count(
        `SELECT COUNT(DISTINCT actor_session_id) AS count FROM events
         WHERE quest_id GLOB 'demo_quest_*'
           AND event_type IN ('challenge.created', 'contribution.created', 'review.supported', 'review.challenged')`,
      ),
    ).toBe(expected.contributors);

    // Event sequence is contiguous starting at 1 immediately after rebuild.
    expect(database.query("SELECT MIN(sequence) AS first, MAX(sequence) AS last FROM events").get()).toEqual({
      first: 1,
      last: expected.public_events,
    });

    // Junk and legacy rows are gone and were not recreated by the seed.
    expect(count("SELECT COUNT(*) AS count FROM quests WHERE id IN ('junk_quest_live', 'quest_open_cancer_research')")).toBe(0);
    expect(count("SELECT COUNT(*) AS count FROM sessions WHERE id GLOB 'junk_session_*'")).toBe(0);
    expect(count("SELECT COUNT(*) AS count FROM rate_limits WHERE bucket_key GLOB 'junk:*'")).toBe(0);
    if (expected.fixture_version === 2) {
      expect(count("SELECT COUNT(*) AS count FROM quests WHERE id = 'demo_quest_tide'")).toBe(0);
      expect(count("SELECT COUNT(*) AS count FROM organizations WHERE verification_status = 'verified'")).toBe(0);
      expect(count("SELECT COUNT(*) AS count FROM organizations WHERE ror_id IS NOT NULL")).toBe(0);
    }
  } finally {
    database.close();
    rmSync(scratchDir, { force: true, recursive: true });
  }
});
