import { z } from "zod";
import {
  ContributionResultSchema,
  EvidenceListSchema,
  GetNextWorkInputSchema,
  ProposeNeedInputSchema,
  ReviewContributionInputSchema,
  SubmitContributionInputSchema,
  type ApiErrorResponse
} from "./contracts";

interface Env {
  DB: D1Database;
}

interface Session {
  id: string;
  token: string;
  created: boolean;
  secure: boolean;
}

interface MissionRow {
  id: string;
  slug: string;
  title: string;
  goal: string;
  description: string;
  type: "discover" | "structure" | "build";
  status: "active" | "complete";
  created_at: string;
  updated_at: string;
}

interface MissionCountRow extends MissionRow {
  open_count: number;
  awaiting_review_count: number;
  resolved_count: number;
}

interface NeedRow {
  id: string;
  mission_id: string;
  title: string;
  instructions: string;
  acceptance_criteria_json: string;
  kind: "question" | "gap" | "check" | "artifact" | "dispute";
  rationale: string;
  priority: number;
  status: "open" | "awaiting_review" | "resolved";
  parent_need_id: string | null;
  created_at: string;
  updated_at: string;
}

interface ContributionRow {
  id: string;
  need_id: string;
  session_id: string;
  summary: string;
  result_json: string;
  evidence_json: string;
  status: "pending" | "accepted" | "challenged" | "superseded";
  created_at: string;
}

interface ReviewRow {
  id: string;
  contribution_id: string;
  reviewer_session_id: string;
  verdict: "support" | "challenge" | "needs_work";
  reason: string;
  evidence_json: string;
  created_at: string;
}

interface EventRow {
  sequence: number;
  mission_id: string;
  entity_type: "need" | "contribution" | "review";
  entity_id: string;
  event_type:
    | "need.created"
    | "contribution.created"
    | "review.supported"
    | "review.challenged"
    | "review.needs_work";
  actor_session_id: string | null;
  payload_json: string;
  created_at: string;
}

interface PublicEvent {
  sequence: number;
  mission_id: string;
  entity_type: EventRow["entity_type"];
  entity_id: string;
  event_type: EventRow["event_type"];
  actor_label: string | null;
  summary: string;
  created_at: string;
}

interface NextContributionRow extends ContributionRow {
  need_title: string;
  need_instructions: string;
  acceptance_criteria_json: string;
  rationale: string;
  kind: NeedRow["kind"];
  priority: number;
  mission_id: string;
  mission_slug: string;
  mission_title: string;
  mission_type: "discover" | "structure" | "build";
}

interface NextNeedRow extends NeedRow {
  mission_slug: string;
  mission_title: string;
  mission_type: "discover" | "structure" | "build";
}

interface ContributionContextRow extends ContributionRow {
  need_title: string;
  need_kind: NeedRow["kind"];
  need_instructions: string;
  need_rationale: string;
  need_acceptance_criteria_json: string;
  need_priority: number;
  need_status: "open" | "awaiting_review" | "resolved";
  need_parent_need_id: string | null;
  need_created_at: string;
  need_updated_at: string;
  mission_id: string;
  mission_slug: string;
  mission_title: string;
}

interface ReviewContextRow {
  id: string;
  session_id: string;
  status: ContributionRow["status"];
  need_status: NeedRow["status"];
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: ApiErrorResponse["status"] = "error"
  ) {
    super(message);
  }
}

const acceptanceCriteriaSchema = z.array(z.string().trim().min(1).max(240)).max(6);
const eventPayloadSchema = z.object({ title: z.string().trim().max(400).optional() }).passthrough();
const worldLimitSchema = z.coerce.number().int().min(1).max(20).default(10);
const sessionPattern = /^[0-9a-f-]{36}$/;
const sessionCookie = "os_session";

function json<Value>(value: Value, status = 200, session?: Session): Response {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
  if (session?.created) {
    const secure = session.secure ? "Secure; " : "";
    headers.append(
      "set-cookie",
      `${sessionCookie}=${session.token}; Path=/; HttpOnly; ${secure}SameSite=Lax; Max-Age=31536000`
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

async function ensureSession(request: Request, env: Env): Promise<Session> {
  const supplied = cookieValue(request, sessionCookie);
  const now = new Date().toISOString();
  const secure = new URL(request.url).protocol === "https:";
  if (supplied && sessionPattern.test(supplied)) {
    const tokenHash = await hashText(`openshare-session:${supplied}`);
    const existing = await env.DB.prepare("SELECT id FROM sessions WHERE token_hash = ?")
      .bind(tokenHash)
      .first<{ id: string }>();
    if (existing) {
      await env.DB.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?")
        .bind(now, existing.id)
        .run();
      return { id: existing.id, token: supplied, created: false, secure };
    }
  }

  const id = crypto.randomUUID();
  const token = crypto.randomUUID();
  const tokenHash = await hashText(`openshare-session:${token}`);
  await env.DB.prepare(
    "INSERT INTO sessions (id, token_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?)"
  )
    .bind(id, tokenHash, now, now)
    .run();
  return { id, token, created: true, secure };
}

async function hashText(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hashAddress(request: Request): Promise<string> {
  const address = request.headers.get("cf-connecting-ip") ?? "local";
  return (await hashText(`openshare-address:${address}`)).slice(0, 24);
}

async function enforceWriteLimit(request: Request, env: Env, session: Session): Promise<void> {
  const bucket = Math.floor(Date.now() / 60_000);
  const resetAt = new Date((bucket + 1) * 60_000).toISOString();
  const ipHash = await hashAddress(request);
  const keys = [`session:${session.id}:${bucket}`, `ip:${ipHash}:${bucket}`];
  const statements = keys.map((key) =>
    env.DB.prepare(
      "INSERT INTO rate_limits (bucket_key, window_started_at, request_count, updated_at) VALUES (?, ?, 1, ?) " +
        "ON CONFLICT(bucket_key, window_started_at) DO UPDATE SET " +
        "request_count = request_count + 1, updated_at = excluded.updated_at"
    ).bind(key, String(bucket), resetAt)
  );
  await env.DB.batch(statements);
  const row = await env.DB.prepare(
    "SELECT MAX(request_count) AS count FROM rate_limits " +
      "WHERE bucket_key IN (?, ?) AND window_started_at = ?"
  )
    .bind(keys[0], keys[1], String(bucket))
    .first<{ count: number }>();
  if ((row?.count ?? 0) > 30) {
    throw new HttpError(429, "Anonymous write limit reached. Try again after one minute.", "rate_limited");
  }
}

function presentMission(row: MissionRow) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    goal: row.goal,
    description: row.description,
    type: row.type,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function parseCriteria(value: string): string[] {
  return acceptanceCriteriaSchema.parse(JSON.parse(value));
}

function presentNeed(row: NeedRow, contribution: ContributionRow | null = null) {
  return {
    id: row.id,
    mission_id: row.mission_id,
    title: row.title,
    instructions: row.instructions,
    acceptance_criteria: parseCriteria(row.acceptance_criteria_json),
    kind: row.kind,
    rationale: row.rationale,
    priority: row.priority,
    status: row.status,
    parent_need_id: row.parent_need_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    contribution: contribution ? presentContribution(contribution) : null
  };
}

function presentWorkNeed(row: NeedRow) {
  return {
    id: row.id,
    mission_id: row.mission_id,
    kind: row.kind,
    title: row.title,
    instructions: row.instructions,
    acceptance_criteria: parseCriteria(row.acceptance_criteria_json),
    rationale: row.rationale,
    priority: row.priority
  };
}

function presentContribution(row: ContributionRow) {
  return {
    id: row.id,
    need_id: row.need_id,
    actor_label: `Session ${row.session_id.slice(0, 6)}`,
    summary: row.summary,
    result: ContributionResultSchema.parse(JSON.parse(row.result_json)),
    evidence: EvidenceListSchema.parse(JSON.parse(row.evidence_json)),
    status: row.status,
    created_at: row.created_at
  };
}

function presentReview(row: ReviewRow) {
  return {
    id: row.id,
    contribution_id: row.contribution_id,
    reviewer_label: `Session ${row.reviewer_session_id.slice(0, 6)}`,
    verdict: row.verdict,
    reason: row.reason,
    evidence: EvidenceListSchema.parse(JSON.parse(row.evidence_json)),
    created_at: row.created_at
  };
}

function presentEvent(row: EventRow): PublicEvent {
  const payload = eventPayloadSchema.parse(JSON.parse(row.payload_json));
  const label = row.event_type
    .replace("need.created", "New Need proposed")
    .replace("contribution.created", "Contribution submitted")
    .replace("review.supported", "Contribution supported")
    .replace("review.challenged", "Contribution challenged")
    .replace("review.needs_work", "More work requested");
  return {
    sequence: row.sequence,
    mission_id: row.mission_id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    event_type: row.event_type,
    actor_label: row.actor_session_id ? `Session ${row.actor_session_id.slice(0, 6)}` : null,
    summary: payload.title ? `${label}: ${payload.title}` : label,
    created_at: row.created_at
  };
}

async function recentEvents(env: Env, missionId?: string): Promise<PublicEvent[]> {
  if (missionId) {
    const result = await env.DB.prepare(
      "SELECT sequence, mission_id, entity_type, entity_id, event_type, actor_session_id, payload_json, created_at " +
        "FROM events WHERE mission_id = ? ORDER BY sequence DESC LIMIT 20"
    )
      .bind(missionId)
      .all<EventRow>();
    return result.results.map(presentEvent);
  }
  const result = await env.DB.prepare(
    "SELECT sequence, mission_id, entity_type, entity_id, event_type, actor_session_id, payload_json, created_at " +
      "FROM events ORDER BY sequence DESC LIMIT 20"
  ).all<EventRow>();
  return result.results.map(presentEvent);
}

async function world(env: Env, missionId: string | undefined, limit: number) {
  let statement = env.DB.prepare(
    "SELECT m.id, m.slug, m.title, m.goal, m.description, m.type, m.status, m.created_at, m.updated_at, " +
      "SUM(CASE WHEN n.status = 'open' THEN 1 ELSE 0 END) AS open_count, " +
      "SUM(CASE WHEN n.status = 'awaiting_review' THEN 1 ELSE 0 END) AS awaiting_review_count, " +
      "SUM(CASE WHEN n.status = 'resolved' THEN 1 ELSE 0 END) AS resolved_count " +
      "FROM missions m LEFT JOIN needs n ON n.mission_id = m.id " +
      "GROUP BY m.id ORDER BY m.created_at LIMIT ?"
  ).bind(limit);
  if (missionId) {
    statement = env.DB.prepare(
      "SELECT m.id, m.slug, m.title, m.goal, m.description, m.type, m.status, m.created_at, m.updated_at, " +
        "SUM(CASE WHEN n.status = 'open' THEN 1 ELSE 0 END) AS open_count, " +
        "SUM(CASE WHEN n.status = 'awaiting_review' THEN 1 ELSE 0 END) AS awaiting_review_count, " +
        "SUM(CASE WHEN n.status = 'resolved' THEN 1 ELSE 0 END) AS resolved_count " +
        "FROM missions m LEFT JOIN needs n ON n.mission_id = m.id WHERE m.id = ? GROUP BY m.id"
    ).bind(missionId);
  }
  const result = await statement
    .all<MissionCountRow>();
  const missions = result.results.map((row) => {
    const total = row.open_count + row.awaiting_review_count + row.resolved_count;
    return {
      ...presentMission(row),
      counts: {
        open: row.open_count,
        awaiting_review: row.awaiting_review_count,
        resolved: row.resolved_count
      },
      progress: total === 0 ? 0 : Math.round((row.resolved_count / total) * 100)
    };
  });
  const totals = missions.reduce(
    (sum, mission) => ({
      open: sum.open + mission.counts.open,
      awaiting_review: sum.awaiting_review + mission.counts.awaiting_review,
      resolved: sum.resolved + mission.counts.resolved
    }),
    { open: 0, awaiting_review: 0, resolved: 0 }
  );
  return {
    missions,
    totals,
    activity: await recentEvents(env, missionId),
    suggested_next: "Call get_next_work to receive one useful item."
  };
}

async function missionDetail(env: Env, slug: string) {
  const mission = await env.DB.prepare(
    "SELECT id, slug, title, goal, description, type, status, created_at, updated_at FROM missions WHERE slug = ?"
  )
    .bind(slug)
    .first<MissionRow>();
  if (!mission) throw new HttpError(404, "Mission not found.", "not_found");
  const needResult = await env.DB.prepare(
    "SELECT id, mission_id, kind, title, instructions, rationale, acceptance_criteria_json, priority, status, " +
      "parent_need_id, created_at, updated_at FROM needs WHERE mission_id = ? " +
      "ORDER BY CASE status WHEN 'awaiting_review' THEN 0 WHEN 'open' THEN 1 ELSE 2 END, priority DESC, created_at " +
      "LIMIT 100"
  )
    .bind(mission.id)
    .all<NeedRow>();
  const contributionResult = await env.DB.prepare(
    "SELECT c.id, c.need_id, c.session_id, c.summary, c.result_json, c.evidence_json, c.status, c.created_at " +
      "FROM contributions c JOIN needs n ON n.id = c.need_id WHERE n.mission_id = ? " +
      "AND c.id = (SELECT c2.id FROM contributions c2 WHERE c2.need_id = c.need_id " +
      "ORDER BY c2.created_at DESC LIMIT 1) ORDER BY c.created_at DESC LIMIT 100"
  )
    .bind(mission.id)
    .all<ContributionRow>();
  const contributionByNeed = new Map(
    contributionResult.results.map((contribution) => [contribution.need_id, contribution])
  );
  const needs = needResult.results.map((need) =>
    presentNeed(need, contributionByNeed.get(need.id) ?? null)
  );
  return {
    mission: presentMission(mission),
    counts: {
      open: needs.filter((need) => need.status === "open").length,
      awaiting_review: needs.filter((need) => need.status === "awaiting_review").length,
      resolved: needs.filter((need) => need.status === "resolved").length
    },
    needs,
    activity: await recentEvents(env, mission.id)
  };
}

async function contributionDetail(env: Env, id: string) {
  const contribution = await env.DB.prepare(
    "SELECT c.id, c.need_id, c.session_id, c.summary, c.result_json, c.evidence_json, c.status, c.created_at, " +
      "n.title AS need_title, n.kind AS need_kind, n.instructions AS need_instructions, " +
      "n.rationale AS need_rationale, n.acceptance_criteria_json AS need_acceptance_criteria_json, " +
      "n.priority AS need_priority, n.status AS need_status, n.parent_need_id AS need_parent_need_id, " +
      "n.created_at AS need_created_at, n.updated_at AS need_updated_at, " +
      "m.id AS mission_id, m.slug AS mission_slug, m.title AS mission_title " +
      "FROM contributions c JOIN needs n ON n.id = c.need_id JOIN missions m ON m.id = n.mission_id WHERE c.id = ?"
  )
    .bind(id)
    .first<ContributionContextRow>();
  if (!contribution) throw new HttpError(404, "Contribution not found.", "not_found");
  const reviewResult = await env.DB.prepare(
    "SELECT id, contribution_id, reviewer_session_id, verdict, reason, evidence_json, created_at " +
      "FROM reviews WHERE contribution_id = ? ORDER BY created_at"
  )
    .bind(id)
    .all<ReviewRow>();
  return {
    contribution: presentContribution(contribution),
    need: {
      id: contribution.need_id,
      mission_id: contribution.mission_id,
      parent_need_id: contribution.need_parent_need_id,
      kind: contribution.need_kind,
      title: contribution.need_title,
      instructions: contribution.need_instructions,
      rationale: contribution.need_rationale,
      acceptance_criteria: parseCriteria(contribution.need_acceptance_criteria_json),
      priority: contribution.need_priority,
      status: contribution.need_status,
      created_at: contribution.need_created_at,
      updated_at: contribution.need_updated_at
    },
    mission: {
      id: contribution.mission_id,
      slug: contribution.mission_slug,
      title: contribution.mission_title
    },
    reviews: reviewResult.results.map(presentReview)
  };
}

async function nextWork(env: Env, session: Session, body: z.infer<typeof GetNextWorkInputSchema>) {
  const mode = body.mode ?? "any";
  if (mode !== "contribute") {
    let sql =
      "SELECT c.id, c.need_id, c.session_id, c.summary, c.result_json, c.evidence_json, c.status, c.created_at, " +
      "n.title AS need_title, n.instructions AS need_instructions, n.rationale, n.acceptance_criteria_json, " +
      "n.kind, n.priority, m.id AS mission_id, m.slug AS mission_slug, " +
      "m.title AS mission_title, m.type AS mission_type " +
      "FROM contributions c JOIN needs n ON n.id = c.need_id JOIN missions m ON m.id = n.mission_id " +
      "WHERE c.status = 'pending' AND c.session_id <> ?";
    const bindings: string[] = [session.id];
    if (body.mission_id) {
      sql += " AND m.id = ?";
      bindings.push(body.mission_id);
    }
    sql += " ORDER BY c.created_at LIMIT 1";
    const review = await env.DB.prepare(sql).bind(...bindings).first<NextContributionRow>();
    if (review) {
      return {
        status: "work_available" as const,
        work_type: "review" as const,
        mission: {
          id: review.mission_id,
          slug: review.mission_slug,
          title: review.mission_title,
          type: review.mission_type
        },
        need: {
          id: review.need_id,
          mission_id: review.mission_id,
          kind: review.kind,
          title: review.need_title,
          instructions: review.need_instructions,
          acceptance_criteria: parseCriteria(review.acceptance_criteria_json),
          rationale: review.rationale,
          priority: review.priority
        },
        contribution: {
          id: review.id,
          summary: review.summary,
          result: ContributionResultSchema.parse(JSON.parse(review.result_json)),
          evidence: EvidenceListSchema.parse(JSON.parse(review.evidence_json))
        },
        why_now: "This contribution is the oldest eligible item waiting for cross-session review.",
        done_when: "Check the work and call review_contribution."
      };
    }
    if (mode === "review") {
      return {
        status: "no_work_available" as const,
        message: "No contribution from another session currently needs review.",
        next_action: "Try get_next_work with mode any later."
      };
    }
  }
  let sql =
    "SELECT n.id, n.mission_id, n.kind, n.title, n.instructions, n.rationale, n.acceptance_criteria_json, n.priority, " +
    "n.status, n.parent_need_id, n.created_at, n.updated_at, m.slug AS mission_slug, " +
    "m.title AS mission_title, m.type AS mission_type " +
    "FROM needs n JOIN missions m ON m.id = n.mission_id WHERE n.status = 'open'";
  const bindings: string[] = [];
  if (body.mission_id) {
    sql += " AND m.id = ?";
    bindings.push(body.mission_id);
  }
  sql += " ORDER BY n.priority DESC, n.created_at LIMIT 1";
  const need = await env.DB.prepare(sql).bind(...bindings).first<NextNeedRow>();
  if (!need) {
    return {
      status: "no_work_available" as const,
      message: "No eligible open Need was found.",
      next_action: "Observe missions or propose a useful Need."
    };
  }
  return {
    status: "work_available" as const,
    work_type: "contribute" as const,
    mission: {
      id: need.mission_id,
      slug: need.mission_slug,
      title: need.mission_title,
      type: need.mission_type
    },
    need: presentWorkNeed(need),
    why_now: "This is the highest-priority open Need in scope.",
    done_when: "Meet the acceptance criteria and call submit_contribution."
  };
}

async function submitContribution(
  env: Env,
  session: Session,
  input: z.infer<typeof SubmitContributionInputSchema>
) {
  const need = await env.DB.prepare(
    "SELECT id, status FROM needs WHERE id = ?"
  )
    .bind(input.need_id)
    .first<Pick<NeedRow, "id" | "status">>();
  if (!need || need.status !== "open") {
    throw new HttpError(409, "This Need is no longer open. Ask for another useful item.", "need_unavailable");
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO contributions (id, need_id, session_id, summary, result_json, evidence_json, status, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)"
  )
    .bind(
      id,
      input.need_id,
      session.id,
      input.summary,
      JSON.stringify(input.result),
      JSON.stringify(input.evidence ?? []),
      now
    )
    .run();
  return {
    status: "submitted" as const,
    contribution_id: id,
    need_status: "awaiting_review" as const,
    message: "Contribution recorded. Another browser session must review it.",
    next_action: {
      tool: "get_next_work" as const,
      reason: "This contribution now needs review from a different browser session."
    }
  };
}

async function reviewContribution(
  env: Env,
  session: Session,
  input: z.infer<typeof ReviewContributionInputSchema>
) {
  const contribution = await env.DB.prepare(
    "SELECT c.id, c.session_id, c.status, n.status AS need_status " +
      "FROM contributions c JOIN needs n ON n.id = c.need_id WHERE c.id = ?"
  )
    .bind(input.contribution_id)
    .first<ReviewContextRow>();
  if (!contribution) throw new HttpError(404, "Contribution not found.", "not_found");
  if (contribution.session_id === session.id) {
    throw new HttpError(403, "A session cannot review its own contribution.", "self_review_forbidden");
  }
  if (contribution.status !== "pending" || contribution.need_status !== "awaiting_review") {
    throw new HttpError(409, "This contribution is no longer awaiting review.", "conflict");
  }
  const duplicate = await env.DB.prepare(
    "SELECT id FROM reviews WHERE contribution_id = ? AND reviewer_session_id = ?"
  )
    .bind(input.contribution_id, session.id)
    .first<{ id: string }>();
  if (duplicate) throw new HttpError(409, "This session already reviewed the contribution.", "duplicate_review");

  const reviewId = crypto.randomUUID();
  const now = new Date().toISOString();
  const supporting = input.verdict === "support";
  const needStatus = supporting ? "resolved" : "open";
  await env.DB.prepare(
    "INSERT INTO reviews (id, contribution_id, reviewer_session_id, verdict, reason, evidence_json, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      reviewId,
      contribution.id,
      session.id,
      input.verdict,
      input.reason,
      JSON.stringify(input.evidence ?? []),
      now
    )
    .run();
  return {
    status: "review_recorded" as const,
    review_id: reviewId,
    verdict: input.verdict,
    need_status: needStatus,
    message: supporting
      ? "A cross-session supporting review resolved this Need."
      : "The review reopened this Need for further work."
  };
}

async function proposeNeed(
  env: Env,
  session: Session,
  input: z.infer<typeof ProposeNeedInputSchema>
) {
  const mission = await env.DB.prepare(
    "SELECT id FROM missions WHERE id = ? AND status = 'active'"
  )
    .bind(input.mission_id)
    .first<{ id: string }>();
  if (!mission) throw new HttpError(404, "Active mission not found.", "not_found");
  if (input.parent_need_id) {
    const parent = await env.DB.prepare("SELECT id FROM needs WHERE id = ? AND mission_id = ?")
      .bind(input.parent_need_id, input.mission_id)
      .first<{ id: string }>();
    if (!parent) throw new HttpError(400, "Parent Need does not belong to this mission.", "invalid_input");
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO needs (id, mission_id, kind, title, instructions, rationale, acceptance_criteria_json, " +
      "priority, status, parent_need_id, created_by_session_id, created_at, updated_at) " +
      "VALUES (?, ?, 'question', ?, ?, ?, ?, 3, 'open', ?, ?, ?, ?)"
  )
    .bind(
      id,
      input.mission_id,
      input.title,
      input.instructions,
      input.rationale,
      JSON.stringify(input.acceptance_criteria ?? []),
      input.parent_need_id ?? null,
      session.id,
      now,
      now
    )
    .run();
  return {
    status: "proposed" as const,
    need_id: id,
    mission_id: input.mission_id,
    need_status: "open" as const,
    message: "The shared frontier now includes this Need.",
    next_action: {
      tool: "get_next_work" as const,
      reason: "This new Need is now open for a contribution."
    }
  };
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const session = await ensureSession(request, env);
  if (request.method === "GET" && url.pathname === "/api/world") {
    const limit = worldLimitSchema.parse(url.searchParams.get("limit") ?? undefined);
    return json(await world(env, url.searchParams.get("mission_id") ?? undefined, limit), 200, session);
  }
  const missionMatch = /^\/api\/missions\/([^/]+)$/.exec(url.pathname);
  if (request.method === "GET" && missionMatch) {
    return json(await missionDetail(env, decodeURIComponent(missionMatch[1])), 200, session);
  }
  const contributionMatch = /^\/api\/contributions\/([^/]+)$/.exec(url.pathname);
  if (request.method === "GET" && contributionMatch) {
    return json(await contributionDetail(env, decodeURIComponent(contributionMatch[1])), 200, session);
  }
  const writePath = ["/api/contributions", "/api/reviews", "/api/needs"].includes(url.pathname);
  if (request.method === "POST" && writePath) await enforceWriteLimit(request, env, session);
  if (request.method === "POST" && url.pathname === "/api/work/next") {
    const input = GetNextWorkInputSchema.parse(await request.json());
    return json(await nextWork(env, session, input), 200, session);
  }
  if (request.method === "POST" && url.pathname === "/api/contributions") {
    const input = SubmitContributionInputSchema.parse(await request.json());
    return json(await submitContribution(env, session, input), 201, session);
  }
  if (request.method === "POST" && url.pathname === "/api/reviews") {
    const input = ReviewContributionInputSchema.parse(await request.json());
    return json(await reviewContribution(env, session, input), 201, session);
  }
  if (request.method === "POST" && url.pathname === "/api/needs") {
    const input = ProposeNeedInputSchema.parse(await request.json());
    return json(await proposeNeed(env, session, input), 201, session);
  }
  throw new HttpError(404, "API route not found.");
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  try {
    return await handleApi(request, env);
  } catch (cause: unknown) {
    if (cause instanceof HttpError) {
      return json({ status: cause.code, message: cause.message }, cause.status);
    }
    if (cause instanceof z.ZodError) {
      return json(
        { status: "invalid_input", message: z.prettifyError(cause) },
        400
      );
    }
    console.error("OpenShare request failed", cause);
    return json({ status: "error", message: "OpenShare could not complete the request." }, 500);
  }
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  }
} satisfies ExportedHandler<Env>;
