import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GLOBAL_OPEN_WORK_STREAM_SQL } from "../src/store";

interface QueryPlanRow { detail: string; }

function applyMigrations(db: Database) {
  const path = join(import.meta.dir, "../migrations");
  for (const name of readdirSync(path).filter((file) => file.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(path, name), "utf8"));
  }
}

test("global open work stream ordering remains covered by its status index", () => {
  const db = new Database(":memory:");
  try {
    applyMigrations(db);
    const details = (db.query(`EXPLAIN QUERY PLAN ${GLOBAL_OPEN_WORK_STREAM_SQL}`).all() as QueryPlanRow[])
      .map((row) => row.detail).join("\n");
    expect(details).toContain("challenges_by_status_created_id");
    expect(details).not.toContain("USE TEMP B-TREE FOR ORDER BY");
  } finally {
    db.close();
  }
});
