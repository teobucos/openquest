import { z } from "zod";
import {
  CreateChallengeInputSchema,
  CreateQuestInputSchema,
  EvidenceListSchema,
  GetNextWorkInputSchema,
  ReviewContributionInputSchema,
  SubmitContributionInputSchema,
  type ApiErrorResponse,
} from "./contracts";

interface Env {
  DB: D1Database;
}

interface ActorIdentity {
  sessionId: string;
  publicLabel: string;
  token: string;
  created: boolean;
  secure: boolean;
}

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

interface QuestCountRow extends QuestRow {
  open_count: number;
  awaiting_review_count: number;
  resolved_count: number;
  active_agents: number;
}

interface ChallengeRow {
  id: string;
  quest_id: string;
  parent_challenge_id: string | null;
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
  entity_type: "quest" | "challenge" | "contribution" | "review";
  entity_id: string;
  event_type:
    | "quest.created"
    | "challenge.created"
    | "contribution.created"
    | "review.supported"
    | "review.challenged";
  actor_session_id: string | null;
  payload_json: string;
  created_at: string;
}

interface LatestContributionRow extends ContributionRow {
  challenge_title: string;
  challenge_description: string;
  challenge_status: ChallengeRow["status"];
  challenge_parent_id: string | null;
  challenge_created_at: string;
  challenge_updated_at: string;
  quest_id: string;
  quest_slug: string;
  quest_title: string;
  quest_goal: string;
  quest_description: string;
}

interface NextChallengeRow extends ChallengeRow {
  quest_slug: string;
  quest_title: string;
  quest_goal: string;
  quest_description: string;
}

interface NextReviewRow extends ContributionRow {
  challenge_title: string;
  challenge_description: string;
  quest_id: string;
  quest_slug: string;
  quest_title: string;
  quest_goal: string;
  quest_description: string;
}

interface ReviewContextRow {
  id: string;
  session_id: string;
  status: ContributionRow["status"];
  challenge_status: ChallengeRow["status"];
}

interface CountRow {
  count: number;
}

interface QuestTotalsRow {
  open_count: number;
  awaiting_review_count: number;
  resolved_count: number;
}

interface IdRow {
  id: string;
}

interface EventPayload {
  quest_title?: string;
  challenge_id?: string;
  challenge_title?: string;
  contribution_id?: string;
  contribution_summary?: string;
}

const EventPayloadSchema: z.ZodType<EventPayload> = z
  .object({
    quest_title: z.string().optional(),
    challenge_id: z.string().optional(),
    challenge_title: z.string().optional(),
    contribution_id: z.string().optional(),
    contribution_summary: z.string().optional(),
  })
  .strip();

const worldLimitSchema = z.coerce.number().int().min(1).max(20).default(10);
const identifierQuerySchema = z.string().trim().min(1).max(128).optional();
const sessionPattern = /^[0-9a-f-]{36}$/;
const sessionCookie = "oq_session";

class HttpError extends Error {
  public constructor(
    readonly httpStatus: number,
    readonly payload: ApiErrorResponse,
  ) {
    super(payload.message);
    this.name = "HttpError";
  }
}

function nextAction(reason: string) {
  return { tool: "openquest_next" as const, reason };
}

function fail(
  httpStatus: number,
  status: ApiErrorResponse["status"],
  message: string,
  action?: ReturnType<typeof nextAction>,
): never {
  throw new HttpError(httpStatus, action
    ? { status, message, next_action: action }
    : { status, message });
}

function json<Value>(value: Value, status = 200, identity?: ActorIdentity): Response {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
  if (identity?.created) {
    const secure = identity.secure ? "Secure; " : "";
    headers.append(
      "set-cookie",
      `${sessionCookie}=${identity.token}; Path=/; HttpOnly; ${secure}SameSite=Lax; Max-Age=31536000`,
    );
  }
  return new Response(JSON.stringify(value), { status, headers });
}

function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function publicLabel(sessionId: string): string {
  return `Agent ${sessionId.replaceAll("-", "").slice(-6).toUpperCase()}`;
}

function identitiesMatch(left: ActorIdentity, sessionId: string): boolean {
  return left.sessionId === sessionId;
}

async function hashText(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function secureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:"
    || request.headers.get("x-forwarded-proto") === "https";
}

async function readIdentity(request: Request, env: Env): Promise<ActorIdentity | null> {
  const supplied = cookieValue(request, sessionCookie);
  if (!supplied || !sessionPattern.test(supplied)) return null;
  const tokenHash = await hashText(`openquest-session:${supplied}`);
  const existing = await env.DB.prepare("SELECT id FROM sessions WHERE token_hash = ?")
    .bind(tokenHash)
    .first<IdRow>();
  if (!existing) return null;
  return {
    sessionId: existing.id,
    publicLabel: publicLabel(existing.id),
    token: supplied,
    created: false,
    secure: secureRequest(request),
  };
}

async function ensureIdentity(request: Request, env: Env): Promise<ActorIdentity> {
  const existing = await readIdentity(request, env);
  const now = new Date().toISOString();
  if (existing) {
    await env.DB.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?")
      .bind(now, existing.sessionId)
      .run();
    return existing;
  }

  const sessionId = crypto.randomUUID();
  const token = crypto.randomUUID();
  const tokenHash = await hashText(`openquest-session:${token}`);
  await env.DB.prepare(
    "INSERT INTO sessions (id, token_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?)",
  )
    .bind(sessionId, tokenHash, now, now)
    .run();
  return {
    sessionId,
    publicLabel: publicLabel(sessionId),
    token,
    created: true,
    secure: secureRequest(request),
  };
}

async function hashAddress(request: Request): Promise<string> {
  const address = request.headers.get("cf-connecting-ip") ?? "local";
  return (await hashText(`openquest-address:${address}`)).slice(0, 24);
}

async function enforceWriteLimit(
  request: Request,
  env: Env,
  identity: ActorIdentity,
): Promise<void> {
  const bucket = Math.floor(Date.now() / 60_000);
  const bucketText = String(bucket);
  const updatedAt = new Date().toISOString();
  const ipHash = await hashAddress(request);
  const sessionKey = `session:${identity.sessionId}:${bucket}`;
  const ipKey = `ip:${ipHash}:${bucket}`;
  const statement =
    "INSERT INTO rate_limits (bucket_key, window_started_at, request_count, updated_at) "
    + "VALUES (?, ?, 1, ?) ON CONFLICT(bucket_key, window_started_at) DO UPDATE SET "
    + "request_count = request_count + 1, updated_at = excluded.updated_at";
  await env.DB.batch([
    env.DB.prepare(statement).bind(sessionKey, bucketText, updatedAt),
    env.DB.prepare(statement).bind(ipKey, bucketText, updatedAt),
  ]);
  const usage = await env.DB.prepare(
    "SELECT MAX(request_count) AS count FROM rate_limits "
    + "WHERE bucket_key IN (?, ?) AND window_started_at = ?",
  )
    .bind(sessionKey, ipKey, bucketText)
    .first<CountRow>();
  if ((usage?.count ?? 0) > 30) {
    fail(429, "rate_limited", "Anonymous write limit reached. Try again after one minute.");
  }
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
    parent_challenge_id: row.parent_challenge_id,
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
    actor_label: publicLabel(row.session_id),
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
    reviewer_label: publicLabel(row.reviewer_session_id),
    verdict: row.verdict,
    reason: row.reason,
    evidence: EvidenceListSchema.parse(JSON.parse(row.evidence_json)),
    created_at: row.created_at,
  };
}

function presentEvent(row: EventRow) {
  const payload = EventPayloadSchema.parse(JSON.parse(row.payload_json));
  let summary: string;
  switch (row.event_type) {
    case "quest.created":
      summary = `New Quest: ${payload.quest_title ?? row.entity_id}`;
      break;
    case "challenge.created":
      summary = `New Challenge: ${payload.challenge_title ?? row.entity_id}`;
      break;
    case "contribution.created":
      summary = `Contribution submitted: ${payload.challenge_title ?? row.entity_id}`;
      break;
    case "review.supported":
      summary = `Resolved: ${payload.challenge_title ?? row.entity_id}`;
      break;
    case "review.challenged":
      summary = `Reopened: ${payload.challenge_title ?? row.entity_id}`;
      break;
  }
  return {
    sequence: row.sequence,
    quest_id: row.quest_id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    event_type: row.event_type,
    actor_label: row.actor_session_id ? publicLabel(row.actor_session_id) : null,
    summary,
    created_at: row.created_at,
  };
}

async function recentEvents(env: Env, questId: string | undefined, limit: number) {
  const filter = questId ? " WHERE quest_id = ?" : "";
  const statement = env.DB.prepare(
    "SELECT sequence, quest_id, entity_type, entity_id, event_type, actor_session_id, "
    + `payload_json, created_at FROM events${filter} ORDER BY sequence DESC LIMIT ?`,
  );
  const result = questId
    ? await statement.bind(questId, limit).all<EventRow>()
    : await statement.bind(limit).all<EventRow>();
  return result.results.map(presentEvent);
}

async function activeAgentCount(env: Env, questId?: string): Promise<number> {
  const filter = questId ? " AND quest_id = ?" : "";
  const statement = env.DB.prepare(
    "SELECT COUNT(DISTINCT actor_session_id) AS count FROM events "
    + "WHERE event_type IN ('challenge.created', 'contribution.created', "
    + "'review.supported', 'review.challenged') "
    + "AND actor_session_id IS NOT NULL "
    + "AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes')"
    + filter,
  );
  const result = questId
    ? await statement.bind(questId).first<CountRow>()
    : await statement.first<CountRow>();
  return result?.count ?? 0;
}

async function challengesForQuest(env: Env, questId: string) {
  const result = await env.DB.prepare(
    "SELECT id, quest_id, parent_challenge_id, title, description, status, created_at, updated_at "
    + "FROM challenges WHERE quest_id = ? "
    + "ORDER BY CASE status WHEN 'awaiting_review' THEN 0 WHEN 'open' THEN 1 ELSE 2 END, created_at, id",
  )
    .bind(questId)
    .all<ChallengeRow>();
  const contributionResult = await env.DB.prepare(
    "SELECT c.id, c.challenge_id, c.session_id, c.summary, c.content, c.evidence_json, c.status, c.created_at "
    + "FROM contributions c JOIN challenges h ON h.id = c.challenge_id WHERE h.quest_id = ? "
    + "AND c.id = (SELECT c2.id FROM contributions c2 WHERE c2.challenge_id = c.challenge_id "
    + "ORDER BY c2.created_at DESC, c2.id DESC LIMIT 1)",
  )
    .bind(questId)
    .all<ContributionRow>();
  const latestByChallenge = new Map(
    contributionResult.results.map((contribution) => [contribution.challenge_id, contribution]),
  );
  return result.results.map((challenge) => {
    const contribution = latestByChallenge.get(challenge.id);
    return {
      ...presentChallenge(challenge),
      contribution: contribution ? presentContribution(contribution) : null,
    };
  });
}

async function world(env: Env, questId: string | undefined, limit: number) {
  const filter = questId ? "WHERE q.id = ? AND q.status = 'active' " : "WHERE q.status = 'active' ";
  const sql =
    "SELECT q.id, q.slug, q.title, q.goal, q.description, q.status, q.created_at, q.updated_at, "
    + "SUM(CASE WHEN c.status = 'open' THEN 1 ELSE 0 END) AS open_count, "
    + "SUM(CASE WHEN c.status = 'awaiting_review' THEN 1 ELSE 0 END) AS awaiting_review_count, "
    + "SUM(CASE WHEN c.status = 'resolved' THEN 1 ELSE 0 END) AS resolved_count, "
    + "(SELECT COUNT(DISTINCT e.actor_session_id) FROM events e WHERE e.quest_id = q.id "
    + "AND e.event_type IN ('challenge.created', 'contribution.created', 'review.supported', 'review.challenged') "
    + "AND e.actor_session_id IS NOT NULL "
    + "AND e.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes')) AS active_agents "
    + "FROM quests q LEFT JOIN challenges c ON c.quest_id = q.id "
    + `${filter}GROUP BY q.id ORDER BY q.created_at, q.id${questId ? "" : " LIMIT ?"}`;
  const result = questId
    ? await env.DB.prepare(sql).bind(questId).all<QuestCountRow>()
    : await env.DB.prepare(sql).bind(limit).all<QuestCountRow>();
  if (questId && result.results.length === 0) {
    fail(404, "not_found", "Active Quest not found.", nextAction("Choose another active Quest."));
  }
  const quests = result.results.map((row) => ({
    ...presentQuest(row),
    counts: {
      open: row.open_count,
      awaiting_review: row.awaiting_review_count,
      resolved: row.resolved_count,
    },
    active_agents: row.active_agents,
  }));
  const totalsFilter = questId ? " AND q.id = ?" : "";
  const totalsStatement = env.DB.prepare(
    "SELECT SUM(CASE WHEN c.status = 'open' THEN 1 ELSE 0 END) AS open_count, "
    + "SUM(CASE WHEN c.status = 'awaiting_review' THEN 1 ELSE 0 END) AS awaiting_review_count, "
    + "SUM(CASE WHEN c.status = 'resolved' THEN 1 ELSE 0 END) AS resolved_count "
    + "FROM quests q LEFT JOIN challenges c ON c.quest_id = q.id WHERE q.status = 'active'"
    + totalsFilter,
  );
  const totalRow = questId
    ? await totalsStatement.bind(questId).first<QuestTotalsRow>()
    : await totalsStatement.first<QuestTotalsRow>();
  const totals = {
    open: totalRow?.open_count ?? 0,
    awaiting_review: totalRow?.awaiting_review_count ?? 0,
    resolved: totalRow?.resolved_count ?? 0,
  };
  return {
    quests,
    totals,
    active_agents: await activeAgentCount(env, questId),
    activity: await recentEvents(env, questId, limit),
    suggested_next: "Call openquest_next to receive one useful item.",
    challenges: questId ? await challengesForQuest(env, questId) : [],
  };
}

async function questDetail(env: Env, slug: string) {
  const quest = await env.DB.prepare(
    "SELECT id, slug, title, goal, description, status, created_at, updated_at FROM quests WHERE slug = ?",
  )
    .bind(slug)
    .first<QuestRow>();
  if (!quest) fail(404, "not_found", "Quest not found.");
  const challengeResult = await env.DB.prepare(
    "SELECT id, quest_id, parent_challenge_id, title, description, status, created_at, updated_at "
    + "FROM challenges WHERE quest_id = ? "
    + "ORDER BY CASE status WHEN 'awaiting_review' THEN 0 WHEN 'open' THEN 1 ELSE 2 END, created_at, id",
  )
    .bind(quest.id)
    .all<ChallengeRow>();
  const contributionResult = await env.DB.prepare(
    "SELECT c.id, c.challenge_id, c.session_id, c.summary, c.content, c.evidence_json, c.status, c.created_at "
    + "FROM contributions c JOIN challenges h ON h.id = c.challenge_id WHERE h.quest_id = ? "
    + "AND c.id = (SELECT c2.id FROM contributions c2 WHERE c2.challenge_id = c.challenge_id "
    + "ORDER BY c2.created_at DESC, c2.id DESC LIMIT 1)",
  )
    .bind(quest.id)
    .all<ContributionRow>();
  const latestByChallenge = new Map(
    contributionResult.results.map((contribution) => [contribution.challenge_id, contribution]),
  );
  const challenges = challengeResult.results.map((challenge) => {
    const contribution = latestByChallenge.get(challenge.id);
    return {
      ...presentChallenge(challenge),
      contribution: contribution ? presentContribution(contribution) : null,
    };
  });
  return {
    quest: presentQuest(quest),
    counts: {
      open: challenges.filter((challenge) => challenge.status === "open").length,
      awaiting_review: challenges.filter((challenge) => challenge.status === "awaiting_review").length,
      resolved: challenges.filter((challenge) => challenge.status === "resolved").length,
    },
    active_agents: await activeAgentCount(env, quest.id),
    challenges,
    activity: await recentEvents(env, quest.id, 50),
  };
}

async function contributionDetail(env: Env, id: string) {
  const contribution = await env.DB.prepare(
    "SELECT c.id, c.challenge_id, c.session_id, c.summary, c.content, c.evidence_json, c.status, c.created_at, "
    + "h.title AS challenge_title, h.description AS challenge_description, h.status AS challenge_status, "
    + "h.parent_challenge_id AS challenge_parent_id, h.created_at AS challenge_created_at, "
    + "h.updated_at AS challenge_updated_at, q.id AS quest_id, q.slug AS quest_slug, "
    + "q.title AS quest_title, q.goal AS quest_goal, q.description AS quest_description "
    + "FROM contributions c JOIN challenges h ON h.id = c.challenge_id "
    + "JOIN quests q ON q.id = h.quest_id WHERE c.id = ?",
  )
    .bind(id)
    .first<LatestContributionRow>();
  if (!contribution) fail(404, "not_found", "Contribution not found.");
  const reviews = await env.DB.prepare(
    "SELECT id, contribution_id, reviewer_session_id, verdict, reason, evidence_json, created_at "
    + "FROM reviews WHERE contribution_id = ? ORDER BY created_at, id",
  )
    .bind(id)
    .all<ReviewRow>();
  return {
    contribution: presentContribution(contribution),
    challenge: {
      id: contribution.challenge_id,
      quest_id: contribution.quest_id,
      parent_challenge_id: contribution.challenge_parent_id,
      title: contribution.challenge_title,
      description: contribution.challenge_description,
      status: contribution.challenge_status,
      created_at: contribution.challenge_created_at,
      updated_at: contribution.challenge_updated_at,
    },
    quest: {
      id: contribution.quest_id,
      slug: contribution.quest_slug,
      title: contribution.quest_title,
    },
    reviews: reviews.results.map(presentReview),
  };
}

function slugBase(title: string): string {
  const slug = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72)
    .replace(/-+$/g, "");
  return slug.length >= 3 ? slug : "quest";
}

async function uniqueSlug(env: Env, title: string): Promise<string> {
  const base = slugBase(title);
  const existing = await env.DB.prepare("SELECT id FROM quests WHERE slug = ?")
    .bind(base)
    .first<IdRow>();
  if (!existing) return base;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 6);
    const candidate = `${base.slice(0, 73)}-${suffix}`;
    const collision = await env.DB.prepare("SELECT id FROM quests WHERE slug = ?")
      .bind(candidate)
      .first<IdRow>();
    if (!collision) return candidate;
  }
  fail(409, "conflict", "Could not generate a unique Quest slug. Please retry.");
}

async function createQuest(
  env: Env,
  identity: ActorIdentity,
  input: z.infer<typeof CreateQuestInputSchema>,
) {
  const id = crypto.randomUUID();
  const slug = await uniqueSlug(env, input.title);
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO quests (id, slug, title, goal, description, status, created_by_session_id, created_at, updated_at) "
    + "VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)",
  )
    .bind(id, slug, input.title, input.goal, input.description ?? "", identity.sessionId, now, now)
    .run();
  return {
    status: "created" as const,
    kind: "quest" as const,
    quest_id: id,
    slug,
    quest_status: "active" as const,
    message: "Quest created and public.",
    next_action: nextAction("Find useful work in the new Quest."),
  };
}

async function createChallenge(
  env: Env,
  identity: ActorIdentity,
  input: z.infer<typeof CreateChallengeInputSchema>,
) {
  const quest = await env.DB.prepare("SELECT id FROM quests WHERE id = ? AND status = 'active'")
    .bind(input.quest_id)
    .first<IdRow>();
  if (!quest) {
    fail(409, "quest_unavailable", "This Quest is not active.", nextAction("Choose another active Quest."));
  }
  if (input.parent_challenge_id) {
    const parent = await env.DB.prepare("SELECT id FROM challenges WHERE id = ? AND quest_id = ?")
      .bind(input.parent_challenge_id, input.quest_id)
      .first<IdRow>();
    if (!parent) fail(400, "invalid_input", "Parent Challenge does not belong to this Quest.");
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO challenges (id, quest_id, parent_challenge_id, title, description, status, "
    + "created_by_session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)",
  )
    .bind(
      id,
      input.quest_id,
      input.parent_challenge_id ?? null,
      input.title,
      input.description,
      identity.sessionId,
      now,
      now,
    )
    .run();
  return {
    status: "created" as const,
    kind: "challenge" as const,
    challenge_id: id,
    quest_id: input.quest_id,
    challenge_status: "open" as const,
    message: "Challenge added to the public frontier.",
    next_action: nextAction("The Challenge is ready for a Contribution."),
  };
}

async function requireActiveQuest(env: Env, questId: string): Promise<void> {
  const quest = await env.DB.prepare("SELECT id FROM quests WHERE id = ? AND status = 'active'")
    .bind(questId)
    .first<IdRow>();
  if (!quest) {
    fail(409, "quest_unavailable", "This Quest is not active.", nextAction("Choose another active Quest."));
  }
}

async function nextWork(
  env: Env,
  identity: ActorIdentity | null,
  input: z.infer<typeof GetNextWorkInputSchema>,
) {
  if (input.quest_id) await requireActiveQuest(env, input.quest_id);
  if (input.mode !== "contribute") {
    let sql =
      "SELECT c.id, c.challenge_id, c.session_id, c.summary, c.content, c.evidence_json, c.status, c.created_at, "
      + "h.title AS challenge_title, h.description AS challenge_description, q.id AS quest_id, "
      + "q.slug AS quest_slug, q.title AS quest_title, q.goal AS quest_goal, q.description AS quest_description "
      + "FROM contributions c JOIN challenges h ON h.id = c.challenge_id "
      + "JOIN quests q ON q.id = h.quest_id WHERE c.status = 'pending' "
      + "AND h.status = 'awaiting_review' AND q.status = 'active'";
    const bindings: string[] = [];
    if (identity) {
      sql += " AND c.session_id <> ?";
      bindings.push(identity.sessionId);
    }
    if (input.quest_id) {
      sql += " AND q.id = ?";
      bindings.push(input.quest_id);
    }
    sql += " ORDER BY c.created_at, c.id LIMIT 1";
    const review = await env.DB.prepare(sql).bind(...bindings).first<NextReviewRow>();
    if (review) {
      return {
        status: "work_available" as const,
        work_type: "review" as const,
        quest: {
          id: review.quest_id,
          slug: review.quest_slug,
          title: review.quest_title,
          goal: review.quest_goal,
          description: review.quest_description,
        },
        challenge: {
          id: review.challenge_id,
          title: review.challenge_title,
          description: review.challenge_description,
        },
        contribution: {
          id: review.id,
          summary: review.summary,
          content: review.content,
          evidence: EvidenceListSchema.parse(JSON.parse(review.evidence_json)),
        },
        why_now: "This is the oldest eligible Contribution waiting for cross-session Review.",
        done_when: "Independently check the work and call openquest_review.",
      };
    }
    if (input.mode === "review") {
      return {
        status: "no_work_available" as const,
      };
    }
  }

  let sql =
    "SELECT h.id, h.quest_id, h.parent_challenge_id, h.title, h.description, h.status, "
    + "h.created_at, h.updated_at, q.slug AS quest_slug, q.title AS quest_title, "
    + "q.goal AS quest_goal, q.description AS quest_description "
    + "FROM challenges h JOIN quests q ON q.id = h.quest_id "
    + "WHERE h.status = 'open' AND q.status = 'active'";
  const bindings: string[] = [];
  if (input.quest_id) {
    sql += " AND q.id = ?";
    bindings.push(input.quest_id);
  }
  sql += " ORDER BY h.created_at, h.id LIMIT 1";
  const challenge = await env.DB.prepare(sql).bind(...bindings).first<NextChallengeRow>();
  if (!challenge) {
    return {
      status: "no_work_available" as const,
    };
  }
  return {
    status: "work_available" as const,
    work_type: "contribute" as const,
    quest: {
      id: challenge.quest_id,
      slug: challenge.quest_slug,
      title: challenge.quest_title,
      goal: challenge.quest_goal,
      description: challenge.quest_description,
    },
    challenge: {
      id: challenge.id,
      title: challenge.title,
      description: challenge.description,
    },
    why_now: "This is the oldest open Challenge in scope.",
    done_when: "Submit useful public work with openquest_submit.",
  };
}

async function submitContribution(
  env: Env,
  identity: ActorIdentity,
  input: z.infer<typeof SubmitContributionInputSchema>,
) {
  const challenge = await env.DB.prepare("SELECT id, status FROM challenges WHERE id = ?")
    .bind(input.challenge_id)
    .first<Pick<ChallengeRow, "id" | "status">>();
  if (!challenge || challenge.status !== "open") {
    fail(
      409,
      "challenge_unavailable",
      "This Challenge is no longer open.",
      nextAction("Find another useful item."),
    );
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO contributions (id, challenge_id, session_id, summary, content, evidence_json, status, created_at) "
    + "VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)",
  )
    .bind(
      id,
      input.challenge_id,
      identity.sessionId,
      input.summary,
      input.content,
      JSON.stringify(input.evidence ?? []),
      now,
    )
    .run();
  return {
    status: "submitted" as const,
    contribution_id: id,
    challenge_status: "awaiting_review" as const,
    message: "Contribution recorded. Another session must review it.",
    next_action: nextAction("Continue with another useful item."),
  };
}

async function reviewContribution(
  env: Env,
  identity: ActorIdentity,
  input: z.infer<typeof ReviewContributionInputSchema>,
) {
  const contribution = await env.DB.prepare(
    "SELECT c.id, c.session_id, c.status, h.status AS challenge_status "
    + "FROM contributions c JOIN challenges h ON h.id = c.challenge_id WHERE c.id = ?",
  )
    .bind(input.contribution_id)
    .first<ReviewContextRow>();
  if (!contribution) fail(404, "not_found", "Contribution not found.");
  if (identitiesMatch(identity, contribution.session_id)) {
    fail(
      403,
      "self_review_forbidden",
      "A session cannot Review its own Contribution.",
      nextAction("Find work created by another session."),
    );
  }
  if (contribution.status !== "pending" || contribution.challenge_status !== "awaiting_review") {
    fail(
      409,
      "contribution_unavailable",
      "This Contribution is no longer awaiting Review.",
      nextAction("Find another useful item."),
    );
  }
  const duplicate = await env.DB.prepare(
    "SELECT id FROM reviews WHERE contribution_id = ? AND reviewer_session_id = ?",
  )
    .bind(input.contribution_id, identity.sessionId)
    .first<IdRow>();
  if (duplicate) {
    fail(409, "duplicate_review", "This session already reviewed the Contribution.", nextAction("Find another item."));
  }
  const reviewId = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO reviews (id, contribution_id, reviewer_session_id, verdict, reason, evidence_json, created_at) "
    + "VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      reviewId,
      input.contribution_id,
      identity.sessionId,
      input.verdict,
      input.reason,
      JSON.stringify(input.evidence ?? []),
      now,
    )
    .run();
  return {
    status: "review_recorded" as const,
    review_id: reviewId,
    verdict: input.verdict,
    challenge_status: input.verdict === "support" ? "resolved" as const : "open" as const,
  };
}

async function parseBody<Output>(request: Request, schema: z.ZodType<Output>): Promise<Output> {
  return schema.parse(await request.json());
}

async function writeIdentity(request: Request, env: Env): Promise<ActorIdentity> {
  const identity = await ensureIdentity(request, env);
  await enforceWriteLimit(request, env, identity);
  return identity;
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/api/world") {
    const limit = worldLimitSchema.parse(url.searchParams.get("limit") ?? undefined);
    const questId = identifierQuerySchema.parse(url.searchParams.get("quest_id") ?? undefined);
    return json(await world(env, questId, limit));
  }

  const questMatch = /^\/api\/quests\/([^/]+)$/.exec(url.pathname);
  if (request.method === "GET" && questMatch) {
    return json(await questDetail(env, decodeURIComponent(questMatch[1])));
  }

  const contributionMatch = /^\/api\/contributions\/([^/]+)$/.exec(url.pathname);
  if (request.method === "GET" && contributionMatch) {
    return json(await contributionDetail(env, decodeURIComponent(contributionMatch[1])));
  }

  if (request.method === "POST" && url.pathname === "/api/work/next") {
    const input = await parseBody(request, GetNextWorkInputSchema);
    return json(await nextWork(env, await readIdentity(request, env), input));
  }

  if (request.method === "POST" && url.pathname === "/api/quests") {
    const input = await parseBody(request, CreateQuestInputSchema);
    const identity = await writeIdentity(request, env);
    return json(await createQuest(env, identity, input), 201, identity);
  }

  if (request.method === "POST" && url.pathname === "/api/challenges") {
    const input = await parseBody(request, CreateChallengeInputSchema);
    const identity = await writeIdentity(request, env);
    return json(await createChallenge(env, identity, input), 201, identity);
  }

  if (request.method === "POST" && url.pathname === "/api/contributions") {
    const input = await parseBody(request, SubmitContributionInputSchema);
    const identity = await writeIdentity(request, env);
    return json(await submitContribution(env, identity, input), 201, identity);
  }

  if (request.method === "POST" && url.pathname === "/api/reviews") {
    const input = await parseBody(request, ReviewContributionInputSchema);
    const identity = await writeIdentity(request, env);
    return json(await reviewContribution(env, identity, input), 201, identity);
  }

  fail(404, "not_found", "API route not found.");
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  try {
    return await handleApi(request, env);
  } catch (cause: unknown) {
    if (cause instanceof HttpError) return json(cause.payload, cause.httpStatus);
    if (cause instanceof z.ZodError) {
      return json({ status: "invalid_input", message: z.prettifyError(cause) }, 400);
    }
    console.error("OpenQuest request failed", cause);
    return json({ status: "error", message: "OpenQuest could not complete the request." }, 500);
  }
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
} satisfies ExportedHandler<Env>;
