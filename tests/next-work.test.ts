import { expect, test } from "bun:test";
import { Database, type SQLQueryBindings } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { StoreError, getContribution, nextWork } from "../src/store";
import type { ApiErrorResponse } from "../src/contracts";

class MemoryD1Statement {
  public constructor(
    private readonly database: Database,
    private readonly sql: string,
    private readonly params: SQLQueryBindings[] = [],
  ) {}

  public bind(...values: SQLQueryBindings[]): MemoryD1Statement {
    return new MemoryD1Statement(this.database, this.sql, values);
  }

  public async first<Row>(): Promise<Row | null> {
    const row = this.params.length === 0
      ? this.database.query(this.sql).get()
      : this.database.query(this.sql).get(...this.params);
    if (row === null || row === undefined) return null;
    // SAFETY: bun:sqlite returns a column-named row for this SELECT.
    return row as Row;
  }

  public async all<Row>(): Promise<{ results: Row[] }> {
    const rows = this.params.length === 0
      ? this.database.query(this.sql).all()
      : this.database.query(this.sql).all(...this.params);
    // SAFETY: bun:sqlite returns column-named rows for this SELECT.
    return { results: rows as Row[] };
  }

  public async run(): Promise<{ success: true }> {
    if (this.params.length === 0) this.database.query(this.sql).run();
    else this.database.query(this.sql).run(...this.params);
    return { success: true };
  }
}

class MemoryD1Database {
  public constructor(private readonly database: Database) {}
  public prepare(sql: string): MemoryD1Statement {
    return new MemoryD1Statement(this.database, sql);
  }
}

function applyMigrations(database: Database) {
  const migrationsPath = join(import.meta.dir, "../migrations");
  for (const name of readdirSync(migrationsPath).filter((file) => file.endsWith(".sql")).sort()) {
    database.exec(readFileSync(join(migrationsPath, name), "utf8"));
  }
}

function asD1(database: Database): D1Database {
  const adapter = new MemoryD1Database(database);
  // SAFETY: MemoryD1Database implements the prepare/bind/first/all/run subset nextWork uses.
  return adapter as unknown as D1Database;
}

async function expectStoreStatus(
  work: Promise<unknown>,
  status: ApiErrorResponse["status"],
): Promise<ApiErrorResponse> {
  try {
    await work;
    throw new Error(`Expected ${status}`);
  } catch (cause) {
    expect(cause).toBeInstanceOf(StoreError);
    if (!(cause instanceof StoreError)) throw cause;
    expect(cause.payload.status).toBe(status);
    return cause.payload;
  }
}

function seedWorld(database: Database) {
  database.exec(`
    INSERT INTO sessions (id, token_hash) VALUES
      ('session_author', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
      ('session_reviewer', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
      ('demo_session_07', 'cccccccccccccccccccccccccccccccc');
    INSERT INTO quests (id, slug, title, goal, description, status, created_by_session_id, created_at, updated_at) VALUES
      ('quest_active', 'active-quest', 'Active Quest', 'Keep a public Quest available for targeting tests.', '', 'active', 'session_author', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('quest_other', 'other-quest', 'Other Quest', 'Hold a second Quest for mismatch targeting tests.', '', 'active', 'session_author', '2026-01-01T00:00:01.000Z', '2026-01-01T00:00:01.000Z'),
      ('quest_inactive', 'inactive-quest', 'Inactive Quest', 'Become inactive after its Challenge exists.', '', 'active', 'session_author', '2026-01-01T00:00:02.000Z', '2026-01-01T00:00:02.000Z');
    INSERT INTO challenges (id, quest_id, title, description, created_by_session_id, created_at, updated_at) VALUES
      ('challenge_open', 'quest_active', 'Open Challenge', 'Remain open so targeting can select this Contribution task.', 'session_author', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z'),
      ('challenge_old_review', 'quest_active', 'Older Review Challenge', 'Hold the oldest pending Contribution for automatic Review-first routing.', 'session_author', '2026-01-02T00:00:01.000Z', '2026-01-02T00:00:01.000Z'),
      ('challenge_fresh_review', 'quest_active', 'Fresh Review Challenge', 'Hold a newer pending Contribution for explicit targeting.', 'session_author', '2026-01-02T00:00:02.000Z', '2026-01-02T00:00:02.000Z'),
      ('challenge_other', 'quest_other', 'Other Quest Challenge', 'Belong to a different Quest for mismatch targeting.', 'session_author', '2026-01-02T00:00:03.000Z', '2026-01-02T00:00:03.000Z'),
      ('challenge_inactive', 'quest_inactive', 'Inactive Quest Challenge', 'Become unavailable after the parent Quest is completed.', 'session_author', '2026-01-02T00:00:04.000Z', '2026-01-02T00:00:04.000Z'),
      ('challenge_resolved', 'quest_active', 'Resolved Challenge', 'Resolve after an accepted Contribution for unavailable targeting.', 'session_author', '2026-01-02T00:00:05.000Z', '2026-01-02T00:00:05.000Z'),
      ('challenge_reopened', 'quest_active', 'Reopened Challenge', 'Reopen after a challenged Contribution for unavailable targeting.', 'session_author', '2026-01-02T00:00:06.000Z', '2026-01-02T00:00:06.000Z');
    INSERT INTO contributions (id, challenge_id, session_id, summary, content, created_at) VALUES
      ('contribution_old', 'challenge_old_review', 'session_author', 'Oldest pending public work.', 'Oldest pending public contribution content.', '2026-01-03T00:00:00.000Z'),
      ('contribution_fresh', 'challenge_fresh_review', 'demo_session_07', 'Fresh pending public work.', 'Fresh pending public contribution content.', '2026-01-03T00:01:00.000Z'),
      ('contribution_accepted', 'challenge_resolved', 'session_author', 'Accepted public work.', 'Accepted public contribution content.', '2026-01-03T00:02:00.000Z'),
      ('contribution_challenged', 'challenge_reopened', 'session_author', 'Challenged public work.', 'Challenged public contribution content.', '2026-01-03T00:03:00.000Z'),
      ('contribution_inactive', 'challenge_inactive', 'session_author', 'Inactive Quest public work.', 'Inactive Quest public contribution content.', '2026-01-03T00:04:00.000Z');
    INSERT INTO reviews (id, contribution_id, reviewer_session_id, verdict, reason, created_at) VALUES
      ('review_support', 'contribution_accepted', 'session_reviewer', 'support', 'Independent support for the accepted Contribution.', '2026-01-04T00:00:00.000Z'),
      ('review_challenge', 'contribution_challenged', 'session_reviewer', 'challenge', 'Independent challenge that reopens the Challenge.', '2026-01-04T00:00:01.000Z');
    UPDATE quests SET status = 'complete' WHERE id = 'quest_inactive';
  `);
}

const author = { id: "session_author" };
const reviewer = { id: "session_reviewer" };

test("automatic mode=any still prefers the oldest eligible Review over open Challenges", async () => {
  const database = new Database(":memory:");
  try {
    applyMigrations(database);
    seedWorld(database);
    const db = asD1(database);
    const automatic = await nextWork(db, reviewer, { mode: "any", quest_id: "quest_active" });
    expect(automatic).toMatchObject({
      contribution: { id: "contribution_old" },
      status: "work_available",
      work_type: "review",
      why_now: "This is the oldest eligible Contribution waiting for cross-session Review.",
    });
    const contribute = await nextWork(db, reviewer, { mode: "contribute", quest_id: "quest_active" });
    expect(contribute).toMatchObject({
      challenge: { id: "challenge_open" },
      status: "work_available",
      work_type: "contribute",
      why_now: "This is the oldest open Challenge in scope.",
    });
  } finally {
    database.close();
  }
});

test("targeted Challenge work returns that exact open Challenge and never falls back", async () => {
  const database = new Database(":memory:");
  try {
    applyMigrations(database);
    seedWorld(database);
    const db = asD1(database);
    const work = await nextWork(db, reviewer, {
      challenge_id: "challenge_open",
      mode: "contribute",
      quest_id: "quest_active",
    });
    expect(work).toMatchObject({
      challenge: { id: "challenge_open" },
      status: "work_available",
      work_type: "contribute",
      why_now: "This specific open Challenge was requested.",
    });
    if (work.status === "work_available") {
      expect(work.why_now).not.toContain("oldest");
    }
    await expectStoreStatus(
      nextWork(db, reviewer, { challenge_id: "challenge_missing", mode: "any" }),
      "challenge_unavailable",
    );
    await expectStoreStatus(
      nextWork(db, reviewer, { challenge_id: "challenge_other", quest_id: "quest_active" }),
      "challenge_unavailable",
    );
    await expectStoreStatus(
      nextWork(db, reviewer, { challenge_id: "challenge_old_review" }),
      "challenge_unavailable",
    );
    await expectStoreStatus(
      nextWork(db, reviewer, { challenge_id: "challenge_resolved" }),
      "challenge_unavailable",
    );
    await expectStoreStatus(
      nextWork(db, reviewer, { challenge_id: "challenge_inactive" }),
      "challenge_unavailable",
    );
  } finally {
    database.close();
  }
});

test("targeted Review returns the requested Contribution and never substitutes older work", async () => {
  const database = new Database(":memory:");
  try {
    applyMigrations(database);
    seedWorld(database);
    const db = asD1(database);
    const work = await nextWork(db, reviewer, {
      contribution_id: "contribution_fresh",
      mode: "review",
      quest_id: "quest_active",
    });
    expect(work).toMatchObject({
      contribution: { id: "contribution_fresh" },
      status: "work_available",
      work_type: "review",
      why_now: "This specific pending Contribution was requested for independent Review.",
    });
    if (work.status === "work_available" && work.work_type === "review") {
      expect(work.contribution.id).not.toBe("contribution_old");
      expect(work.why_now).not.toContain("oldest");
    }
    const selfTarget = await expectStoreStatus(
      nextWork(db, author, { contribution_id: "contribution_old", mode: "review" }),
      "self_review_forbidden",
    );
    expect(selfTarget.next_action?.tool).toBe("openquest_next");
    const automatic = await nextWork(db, author, { mode: "any", quest_id: "quest_active" });
    expect(automatic).toMatchObject({
      contribution: { id: "contribution_fresh" },
      status: "work_available",
      work_type: "review",
    });
    await expectStoreStatus(
      nextWork(db, reviewer, { contribution_id: "contribution_missing" }),
      "contribution_unavailable",
    );
    await expectStoreStatus(
      nextWork(db, reviewer, { contribution_id: "contribution_fresh", quest_id: "quest_other" }),
      "contribution_unavailable",
    );
    await expectStoreStatus(
      nextWork(db, reviewer, { contribution_id: "contribution_accepted" }),
      "contribution_unavailable",
    );
    await expectStoreStatus(
      nextWork(db, reviewer, { contribution_id: "contribution_challenged" }),
      "contribution_unavailable",
    );
    await expectStoreStatus(
      nextWork(db, reviewer, { contribution_id: "contribution_inactive" }),
      "contribution_unavailable",
    );
  } finally {
    database.close();
  }
});

test("demo Contribution authors present as Demo Agent XX through shipped presentation", async () => {
  const database = new Database(":memory:");
  try {
    applyMigrations(database);
    seedWorld(database);
    const detail = await getContribution(asD1(database), "contribution_fresh");
    expect(detail.contribution.actor_label).toBe("Demo Agent 07");
  } finally {
    database.close();
  }
});
