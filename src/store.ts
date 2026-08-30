import type { z } from "zod";
import { EvidenceListSchema, type ApiErrorResponse } from "./contracts";
import { publicActorLabel, type ActorIdentity } from "./identity";

interface QuestRow {
  id: string;
  slug: string;
  title: string;
  goal: string;
  description: string;
  status: "active" | "complete";
  created_at: string;
  updated_at: string;
}

interface ChallengeRow {
  id: string;
  quest_id: string;
  title: string;
  description: string;
  status: "open" | "awaiting_review" | "resolved";
  created_at: string;
  updated_at: string;
}

interface ContributionRow {
  id: string;
  challenge_id: string;
  session_id: string;
  summary: string;
  content: string;
  evidence_json: string;
  status: "pending" | "accepted" | "challenged";
  created_at: string;
}

interface ReviewRow {
  id: string;
  contribution_id: string;
  reviewer_session_id: string;
  verdict: "support" | "challenge";
  reason: string;
  evidence_json: string;
  created_at: string;
}

interface EventRow {
  sequence: number;
  quest_id: string;
  entity_id: string;
  event_type: "quest.created" | "challenge.created" | "contribution.created" | "review.supported" | "review.challenged";
  actor_session_id: string | null;
  summary: string;
  created_at: string;
}

interface CountRow {
  count: number;
}

interface QuestCountsRow {
  open: number;
  awaiting_review: number;
  resolved: number;
}

interface QuestCardRow extends QuestRow, QuestCountsRow {
  active_agents: number;
}

interface ChallengePreviewRow extends ChallengeRow {
  contribution_id: string | null;
  contribution_summary: string | null;
  contribution_status: ContributionRow["status"] | null;
  contribution_created_at: string | null;
}

interface QuestWorkRow extends QuestRow {
  challenge_id: string;
  challenge_title: string;
  challenge_description: string;
}

interface ReviewWorkRow extends ContributionRow {
  challenge_title: string;
  challenge_description: string;
  quest_id: string;
  quest_slug: string;
  quest_title: string;
  quest_goal: string;
  quest_description: string;
}

interface ContributionDetailRow extends ContributionRow {
  challenge_title: string;
  challenge_description: string;
  challenge_status: ChallengeRow["status"];
  challenge_created_at: string;
  challenge_updated_at: string;
  quest_id: string;
  quest_slug: string;
  quest_title: string;
}

interface IdRow {
  id: string;
}

type EvidenceList = z.output<typeof EvidenceListSchema>;

export class StoreError extends Error {
  public constructor(
    public readonly httpStatus: number,
    public readonly payload: ApiErrorResponse,
  ) {
    super(payload.message);
    this.name = "StoreError";
  }
}

function nextAction(reason: string) {
  return { tool: "openquest_next" as const, reason };
}

function storeFail(
  httpStatus: number,
  status: ApiErrorResponse["status"],
  message: string,
  action?: ReturnType<typeof nextAction>,
): never {
  throw new StoreError(httpStatus, action ? { status, message, next_action: action } : { status, message });
}

function mapDatabaseError(cause: unknown): never {
  const message = cause instanceof Error ? cause.message : "";
  if (message.includes("challenge_unavailable")) {
    storeFail(409, "challenge_unavailable", "This Challenge is no longer open.", nextAction("Find another useful item."));
  }
  if (message.includes("contribution_unavailable") || message.includes("UNIQUE constraint failed: reviews.contribution_id")) {
    storeFail(409, "contribution_unavailable", "This Contribution is no longer awaiting Review.", nextAction("Find another useful item."));
  }
  if (message.includes("self_review_forbidden")) {
    storeFail(403, "self_review_forbidden", "A session cannot Review its own Contribution.", nextAction("Find work created by another session."));
  }
  if (message.includes("quest_unavailable")) {
    storeFail(409, "quest_unavailable", "This Quest is not active.", nextAction("Choose another active Quest."));
  }
  throw cause;
}

function presentQuest(row: QuestRow) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    goal: row.goal,
    description: row.description,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function presentChallenge(row: ChallengeRow) {
  return {
    id: row.id,
    quest_id: row.quest_id,
    title: row.title,
    description: row.description,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function presentContribution(row: ContributionRow) {
  return {
    id: row.id,
    challenge_id: row.challenge_id,
    actor_label: publicActorLabel(row.session_id),
    summary: row.summary,
    content: row.content,
    evidence: EvidenceListSchema.parse(JSON.parse(row.evidence_json)),
    status: row.status,
    created_at: row.created_at,
  };
}

function presentReview(row: ReviewRow) {
  return {
    id: row.id,
    contribution_id: row.contribution_id,
    reviewer_label: publicActorLabel(row.reviewer_session_id),
    verdict: row.verdict,
    reason: row.reason,
    evidence: EvidenceListSchema.parse(JSON.parse(row.evidence_json)),
    created_at: row.created_at,
  };
}

async function recentEvents(db: D1Database, questId: string | undefined, limit: number) {
  const statement = db.prepare(
    `SELECT sequence, quest_id, entity_id, event_type, actor_session_id, summary, created_at FROM events${questId ? " WHERE quest_id = ?" : ""} ORDER BY sequence DESC LIMIT ?`,
  );
  const result = questId
    ? await statement.bind(questId, limit).all<EventRow>()
    : await statement.bind(limit).all<EventRow>();
  return result.results.map((row) => ({
    sequence: row.sequence,
    quest_id: row.quest_id,
    entity_id: row.entity_id,
    event_type: row.event_type,
    actor_label: row.event_type === "quest.created" ? null : row.actor_session_id ? publicActorLabel(row.actor_session_id) : null,
    summary: row.summary,
    created_at: row.created_at,
  }));
}

async function activeAgentCount(db: D1Database, questId?: string): Promise<number> {
  const result = await db.prepare(
    "SELECT COUNT(DISTINCT actor_session_id) AS count FROM events "
      + "WHERE event_type IN ('challenge.created', 'contribution.created', 'review.supported', 'review.challenged') "
      + "AND actor_session_id IS NOT NULL AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes')"
      + (questId ? " AND quest_id = ?" : ""),
  ).bind(...(questId ? [questId] : [])).first<CountRow>();
  return result?.count ?? 0;
}

async function getQuestCounts(db: D1Database, questId: string) {
  const row = await db.prepare(
    "SELECT COALESCE(SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END), 0) AS open, "
      + "COALESCE(SUM(CASE WHEN status = 'awaiting_review' THEN 1 ELSE 0 END), 0) AS awaiting_review, "
      + "COALESCE(SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END), 0) AS resolved "
      + "FROM challenges WHERE quest_id = ?",
  ).bind(questId).first<QuestCountsRow>();
  return row ?? { open: 0, awaiting_review: 0, resolved: 0 };
}

async function listQuestCards(db: D1Database, limit: number, questId?: string) {
  const result = await db.prepare(
    "SELECT q.id, q.slug, q.title, q.goal, q.description, q.status, q.created_at, q.updated_at, "
      + "COALESCE(SUM(CASE WHEN c.status = 'open' THEN 1 ELSE 0 END), 0) AS open, "
      + "COALESCE(SUM(CASE WHEN c.status = 'awaiting_review' THEN 1 ELSE 0 END), 0) AS awaiting_review, "
      + "COALESCE(SUM(CASE WHEN c.status = 'resolved' THEN 1 ELSE 0 END), 0) AS resolved, "
      + "(SELECT COUNT(DISTINCT e.actor_session_id) FROM events e "
      + "WHERE e.quest_id = q.id "
      + "AND e.event_type IN ('challenge.created', 'contribution.created', 'review.supported', 'review.challenged') "
      + "AND e.actor_session_id IS NOT NULL "
      + "AND e.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes')) AS active_agents "
      + "FROM quests q LEFT JOIN challenges c ON c.quest_id = q.id "
      + (questId ? "WHERE q.id = ? " : "WHERE q.status = 'active' ")
      + "GROUP BY q.id ORDER BY q.created_at DESC, q.id DESC"
      + (questId ? "" : " LIMIT ?"),
  ).bind(...(questId ? [questId] : [limit])).all<QuestCardRow>();
  return result.results.map((row) => ({
    ...presentQuest(row),
    counts: {
      open: row.open,
      awaiting_review: row.awaiting_review,
      resolved: row.resolved,
    },
    active_agents: row.active_agents,
  }));
}

async function activeQuestCounts(db: D1Database) {
  const row = await db.prepare(
    "SELECT COALESCE(SUM(CASE WHEN c.status = 'open' THEN 1 ELSE 0 END), 0) AS open, "
      + "COALESCE(SUM(CASE WHEN c.status = 'awaiting_review' THEN 1 ELSE 0 END), 0) AS awaiting_review, "
      + "COALESCE(SUM(CASE WHEN c.status = 'resolved' THEN 1 ELSE 0 END), 0) AS resolved "
      + "FROM quests q LEFT JOIN challenges c ON c.quest_id = q.id WHERE q.status = 'active'",
  ).first<QuestCountsRow>();
  return row ?? { open: 0, awaiting_review: 0, resolved: 0 };
}

async function listChallengePreviews(db: D1Database, questId: string, limit = 100) {
  const result = await db.prepare(
    "SELECT h.id, h.quest_id, h.title, h.description, h.status, h.created_at, h.updated_at, "
      + "c.id AS contribution_id, c.summary AS contribution_summary, c.status AS contribution_status, c.created_at AS contribution_created_at "
      + "FROM challenges h LEFT JOIN contributions c ON c.id = (SELECT c2.id FROM contributions c2 WHERE c2.challenge_id = h.id ORDER BY c2.created_at DESC, c2.id DESC LIMIT 1) "
      + "WHERE h.quest_id = ? ORDER BY CASE h.status WHEN 'awaiting_review' THEN 0 WHEN 'open' THEN 1 ELSE 2 END, h.created_at, h.id LIMIT ?",
  ).bind(questId, limit).all<ChallengePreviewRow>();
  return result.results.map((row) => ({
    ...presentChallenge(row),
    contribution: row.contribution_id && row.contribution_summary && row.contribution_status && row.contribution_created_at
      ? {
          id: row.contribution_id,
          summary: row.contribution_summary,
          status: row.contribution_status,
          created_at: row.contribution_created_at,
        }
      : null,
  }));
}

export async function observeState(db: D1Database, questId: string | undefined, limit: number) {
  if (questId) {
    const quests = await listQuestCards(db, limit, questId);
    const quest = quests[0];
    if (!quest) {
      storeFail(404, "not_found", "Quest not found.", nextAction("Choose another Quest."));
    }
    const [challenges, activity] = await Promise.all([
      listChallengePreviews(db, questId),
      recentEvents(db, questId, limit),
    ]);
    return {
      quests,
      totals: quest.counts,
      active_agents: quest.active_agents,
      challenges,
      activity,
    };
  }

  const [quests, totals, active_agents, activity] = await Promise.all([
    listQuestCards(db, limit),
    activeQuestCounts(db),
    activeAgentCount(db),
    recentEvents(db, undefined, limit),
  ]);
  return {
    quests,
    totals,
    active_agents,
    activity,
  };
}

export async function getQuest(db: D1Database, slug: string) {
  const quest = await db.prepare(
    "SELECT id, slug, title, goal, description, status, created_at, updated_at FROM quests WHERE slug = ?",
  ).bind(slug).first<QuestRow>();
  if (!quest) storeFail(404, "not_found", "Quest not found.");
  return {
    quest: presentQuest(quest),
    counts: await getQuestCounts(db, quest.id),
    active_agents: await activeAgentCount(db, quest.id),
    challenges: await listChallengePreviews(db, quest.id),
    activity: await recentEvents(db, quest.id, 50),
  };
}

export async function getContribution(db: D1Database, id: string) {
  const contribution = await db.prepare(
    "SELECT c.id, c.challenge_id, c.session_id, c.summary, c.content, c.evidence_json, c.status, c.created_at, "
      + "h.title AS challenge_title, h.description AS challenge_description, h.status AS challenge_status, h.created_at AS challenge_created_at, h.updated_at AS challenge_updated_at, "
      + "q.id AS quest_id, q.slug AS quest_slug, q.title AS quest_title FROM contributions c JOIN challenges h ON h.id = c.challenge_id JOIN quests q ON q.id = h.quest_id WHERE c.id = ?",
  ).bind(id).first<ContributionDetailRow>();
  if (!contribution) storeFail(404, "not_found", "Contribution not found.");
  const review = await db.prepare(
    "SELECT id, contribution_id, reviewer_session_id, verdict, reason, evidence_json, created_at FROM reviews WHERE contribution_id = ?",
  ).bind(id).first<ReviewRow>();
  return {
    contribution: presentContribution(contribution),
    challenge: {
      id: contribution.challenge_id,
      quest_id: contribution.quest_id,
      title: contribution.challenge_title,
      description: contribution.challenge_description,
      status: contribution.challenge_status,
      created_at: contribution.challenge_created_at,
      updated_at: contribution.challenge_updated_at,
    },
    quest: { id: contribution.quest_id, slug: contribution.quest_slug, title: contribution.quest_title },
    review: review ? presentReview(review) : null,
  };
}

function questSlug(title: string, id: string): string {
  const base = title.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70).replace(/-+$/g, "") || "quest";
  return `${base}-${id.replaceAll("-", "").slice(0, 8)}`;
}

export async function createQuest(
  db: D1Database,
  actor: ActorIdentity,
  input: { title: string; goal: string; description: string },
) {
  const id = crypto.randomUUID();
  const slug = questSlug(input.title, id);
  const now = new Date().toISOString();
  await db.prepare(
    "INSERT INTO quests (id, slug, title, goal, description, status, created_by_session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)",
  ).bind(id, slug, input.title, input.goal, input.description, actor.id, now, now).run();
  return { status: "created" as const, kind: "quest" as const, quest_id: id, slug, quest_status: "active" as const, message: "Quest created and public.", next_action: nextAction("Find useful work in the new Quest.") };
}

export async function createChallenge(
  db: D1Database,
  actor: ActorIdentity,
  input: { quest_id: string; title: string; description: string },
) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await db.prepare(
      "INSERT INTO challenges (id, quest_id, title, description, status, created_by_session_id, created_at, updated_at) VALUES (?, ?, ?, ?, 'open', ?, ?, ?)",
    ).bind(id, input.quest_id, input.title, input.description, actor.id, now, now).run();
  } catch (cause) {
    mapDatabaseError(cause);
  }
  return { status: "created" as const, kind: "challenge" as const, challenge_id: id, quest_id: input.quest_id, challenge_status: "open" as const, message: "Challenge added to the public frontier.", next_action: nextAction("The Challenge is ready for a Contribution.") };
}

async function requireActiveQuest(db: D1Database, questId: string): Promise<void> {
  const quest = await db.prepare("SELECT id FROM quests WHERE id = ? AND status = 'active'").bind(questId).first<IdRow>();
  if (!quest) storeFail(409, "quest_unavailable", "This Quest is not active.", nextAction("Choose another active Quest."));
}

export async function nextWork(
  db: D1Database,
  actor: ActorIdentity | null,
  input: { quest_id?: string; mode?: "any" | "contribute" | "review" },
) {
  const mode = input.mode ?? "any";
  if (input.quest_id) await requireActiveQuest(db, input.quest_id);
  if (mode !== "contribute") {
    let sql = "SELECT c.id, c.challenge_id, c.session_id, c.summary, c.content, c.evidence_json, c.status, c.created_at, h.title AS challenge_title, h.description AS challenge_description, q.id AS quest_id, q.slug AS quest_slug, q.title AS quest_title, q.goal AS quest_goal, q.description AS quest_description FROM contributions c JOIN challenges h ON h.id = c.challenge_id JOIN quests q ON q.id = h.quest_id WHERE c.status = 'pending' AND h.status = 'awaiting_review' AND q.status = 'active'";
    const bindings: string[] = [];
    if (actor) { sql += " AND c.session_id <> ?"; bindings.push(actor.id); }
    if (input.quest_id) { sql += " AND q.id = ?"; bindings.push(input.quest_id); }
    sql += " ORDER BY c.created_at, c.id LIMIT 1";
    const review = await db.prepare(sql).bind(...bindings).first<ReviewWorkRow>();
    if (review) return { status: "work_available" as const, work_type: "review" as const, quest: { id: review.quest_id, slug: review.quest_slug, title: review.quest_title, goal: review.quest_goal, description: review.quest_description }, challenge: { id: review.challenge_id, title: review.challenge_title, description: review.challenge_description }, contribution: { id: review.id, summary: review.summary, content: review.content, evidence: EvidenceListSchema.parse(JSON.parse(review.evidence_json)) }, why_now: "This is the oldest eligible Contribution waiting for cross-session Review.", done_when: "Independently check the work and call openquest_review." };
    if (mode === "review") return { status: "no_work_available" as const };
  }
  let sql = "SELECT q.id, q.slug, q.title, q.goal, q.description, q.status, q.created_at, q.updated_at, h.id AS challenge_id, h.title AS challenge_title, h.description AS challenge_description FROM challenges h JOIN quests q ON q.id = h.quest_id WHERE h.status = 'open' AND q.status = 'active'";
  const bindings: string[] = [];
  if (input.quest_id) { sql += " AND q.id = ?"; bindings.push(input.quest_id); }
  sql += " ORDER BY h.created_at, h.id LIMIT 1";
  const challenge = await db.prepare(sql).bind(...bindings).first<QuestWorkRow>();
  if (!challenge) return { status: "no_work_available" as const };
  return { status: "work_available" as const, work_type: "contribute" as const, quest: { id: challenge.id, slug: challenge.slug, title: challenge.title, goal: challenge.goal, description: challenge.description }, challenge: { id: challenge.challenge_id, title: challenge.challenge_title, description: challenge.challenge_description }, why_now: "This is the oldest open Challenge in scope.", done_when: "Submit useful public work with openquest_submit." };
}

export async function submitContribution(
  db: D1Database,
  actor: ActorIdentity,
  input: { challenge_id: string; summary: string; content: string; evidence: EvidenceList },
) {
  const id = crypto.randomUUID();
  try {
    await db.prepare(
      "INSERT INTO contributions (id, challenge_id, session_id, summary, content, evidence_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)",
    ).bind(id, input.challenge_id, actor.id, input.summary, input.content, JSON.stringify(input.evidence), new Date().toISOString()).run();
  } catch (cause) {
    mapDatabaseError(cause);
  }
  return { status: "submitted" as const, contribution_id: id, challenge_status: "awaiting_review" as const, message: "Contribution recorded. Another session must review it.", next_action: nextAction("Continue with another useful item.") };
}

export async function reviewContribution(
  db: D1Database,
  actor: ActorIdentity,
  input: {
    contribution_id: string;
    verdict: "support" | "challenge";
    reason: string;
    evidence: EvidenceList;
  },
) {
  const id = crypto.randomUUID();
  try {
    await db.prepare(
      "INSERT INTO reviews (id, contribution_id, reviewer_session_id, verdict, reason, evidence_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, input.contribution_id, actor.id, input.verdict, input.reason, JSON.stringify(input.evidence), new Date().toISOString()).run();
  } catch (cause) {
    mapDatabaseError(cause);
  }
  return { status: "review_recorded" as const, review_id: id, verdict: input.verdict, challenge_status: input.verdict === "support" ? "resolved" as const : "open" as const };
}
