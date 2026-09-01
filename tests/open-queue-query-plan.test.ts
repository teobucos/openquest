import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GLOBAL_OPEN_QUEUE_SQL } from "../src/store";

interface QueryPlanRow {
  detail: string;
}

function applyMigrations(db: Database) {
  const migrationsPath = join(import.meta.dir, "../migrations");
  const migrationNames = readdirSync(migrationsPath)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const migrationName of migrationNames) {
    db.exec(readFileSync(join(migrationsPath, migrationName), "utf8"));
  }
}

test("the global open-work queue is ordered by its status index", () => {
  const db = new Database(":memory:");

  try {
    applyMigrations(db);
    const plan = db.query(`EXPLAIN QUERY PLAN ${GLOBAL_OPEN_QUEUE_SQL}`).all() as QueryPlanRow[];
    const details = plan.map((row) => row.detail);
    const combinedDetails = details.join("\n");

    expect(combinedDetails).toContain("challenges_by_status_created_id");
    expect(combinedDetails).not.toContain("USE TEMP B-TREE FOR ORDER BY");
  } finally {
    db.close();
  }
});
