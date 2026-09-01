import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface QueryPlanRow {
  detail: string;
}

function applyMigrations(db: Database): void {
  const migrations = join(import.meta.dir, "../migrations");
  for (const name of readdirSync(migrations).filter((file) => file.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(migrations, name), "utf8"));
  }
}

function explain(db: Database, sql: string): string {
  return (db.query(`EXPLAIN QUERY PLAN ${sql}`).all() as QueryPlanRow[])
    .map((row) => row.detail)
    .join("\n");
}

test("hot public projection queries use their dedicated indexes", () => {
  const db = new Database(":memory:");
  try {
    applyMigrations(db);

    const historyPlan = explain(db,
      "SELECT id FROM contributions WHERE challenge_id = ? ORDER BY created_at DESC, id DESC LIMIT 20",
    );
    expect(historyPlan).toContain("contributions_by_challenge_created");
    expect(historyPlan).not.toContain("USE TEMP B-TREE FOR ORDER BY");

    const freshnessPlan = explain(db,
      "SELECT COALESCE(MAX(sequence), 0), COUNT(*) FROM events WHERE quest_id = ?",
    );
    expect(freshnessPlan).toContain("events_by_quest_sequence");

    const contributorPlan = explain(db,
      "WITH contributor_events AS ("
        + "SELECT e.actor_session_id, e.sequence, "
        + "COUNT(*) OVER (PARTITION BY e.actor_session_id) AS activity_count, "
        + "ROW_NUMBER() OVER (PARTITION BY e.actor_session_id ORDER BY e.sequence DESC) AS recency "
        + "FROM events e INDEXED BY events_by_contributor_recency "
        + "WHERE e.event_type IN ('challenge.created', 'contribution.created', 'review.supported', 'review.challenged') "
        + "AND e.actor_session_id IS NOT NULL"
        + ") SELECT actor_session_id, activity_count FROM contributor_events "
        + "WHERE recency = 1 ORDER BY sequence DESC LIMIT 20",
    );
    expect(contributorPlan).toContain("events_by_contributor_recency");

    // The final sort ranks one latest event per contributor before applying its
    // 20-row response bound. It necessarily scales with distinct contributors;
    // the partial index still avoids scanning non-contributor event types.
    expect(contributorPlan.match(/USE TEMP B-TREE FOR ORDER BY/g)).toHaveLength(1);
  } finally {
    db.close();
  }
});
