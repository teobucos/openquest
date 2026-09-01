import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function applyMigrations(db: Database) {
  const migrationsPath = join(import.meta.dir, "../migrations");
  for (const name of readdirSync(migrationsPath).filter((file) => file.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(migrationsPath, name), "utf8"));
  }
}

test("the additive live-domain migration preserves deterministic fixture chronology", () => {
  const db = new Database(":memory:");
  try {
    applyMigrations(db);
    db.exec("INSERT INTO sessions (id, token_hash) VALUES ('session_author', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), ('session_reviewer', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')");
    db.exec("INSERT INTO organizations (id, slug, name, category, verification_status, is_demo, ror_id, created_at, updated_at) VALUES ('organization_demo', 'fictional-lab', 'Fictional Lab', 'research', 'unverified', 1, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')");
    db.exec("INSERT INTO quests (id, slug, title, goal, description, created_by_session_id, primary_organization_id, created_at, updated_at) VALUES ('quest_fixture', 'fixture-quest', 'Fixture Quest', 'Establish a deterministic public fixture chronology.', '', 'session_author', 'organization_demo', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z')");
    db.exec("INSERT INTO challenges (id, quest_id, title, description, created_by_session_id, created_at, updated_at) VALUES ('challenge_fixture', 'quest_fixture', 'Fixture Challenge', 'Use source record times for every generated public event.', 'session_author', '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z')");
    db.exec("INSERT INTO contributions (id, challenge_id, session_id, summary, content, created_at) VALUES ('contribution_fixture', 'challenge_fixture', 'session_author', 'Fixture contribution', 'Deterministic public fixture content.', '2026-01-04T00:00:00.000Z')");
    db.exec("INSERT INTO reviews (id, contribution_id, reviewer_session_id, verdict, reason, created_at) VALUES ('review_fixture', 'contribution_fixture', 'session_reviewer', 'support', 'A separate fixture reviewer supports this public contribution.', '2026-01-05T00:00:00.000Z')");

    const eventTimes = db.query("SELECT event_type, created_at FROM events WHERE quest_id = 'quest_fixture' ORDER BY sequence ASC").all() as Array<{ event_type: string; created_at: string }>;
    expect(eventTimes).toEqual([
      { event_type: "quest.created", created_at: "2026-01-02T00:00:00.000Z" },
      { event_type: "challenge.created", created_at: "2026-01-03T00:00:00.000Z" },
      { event_type: "contribution.created", created_at: "2026-01-04T00:00:00.000Z" },
      { event_type: "review.supported", created_at: "2026-01-05T00:00:00.000Z" },
    ]);
    expect(db.query("SELECT status, updated_at FROM challenges WHERE id = 'challenge_fixture'").get()).toEqual({ status: "resolved", updated_at: "2026-01-05T00:00:00.000Z" });
    expect(db.query("SELECT primary_organization_id FROM quests WHERE id = 'quest_fixture'").get()).toEqual({ primary_organization_id: "organization_demo" });
  } finally {
    db.close();
  }
});
