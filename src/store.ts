import type { z } from "zod";
import { EvidenceListSchema, type ApiErrorResponse } from "./contracts";
import { publicActorLabel, type ActorIdentity } from "./identity";

interface OrganizationRow {
  organization_id: string | null;
  organization_slug: string | null;
  organization_name: string | null;
  organization_category: "research" | "education" | "healthcare" | "company" | "nonprofit" | "government" | "funder" | "other" | null;
  organization_verification_status: "unverified" | "verified" | null;
  organization_is_demo: number | null;
  organization_ror_id: string | null;
}

interface QuestRow extends OrganizationRow {
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
  quest_slug: string;
  quest_title: string;
  entity_id: string;
  event_type: "quest.created" | "challenge.created" | "contribution.created" | "review.supported" | "review.challenged";
  actor_session_id: string | null;
  summary: string;
  created_at: string;
}

interface CountRow { count: number; }
interface QuestCountsRow { open: number; awaiting_review: number; resolved: number; }
interface FreshnessRow { last_sequence: number; event_count: number; }
interface IdRow { id: string; }
interface ContributorRow extends OrganizationRow {
  actor_session_id: string;
  quest_id: string;
  quest_slug: string;
  quest_title: string;
  event_type: "challenge.created" | "contribution.created" | "review.supported" | "review.challenged";
  entity_id: string;
  summary: string;
  created_at: string;
  activity_count: number;
}
interface WorkStreamRow extends OrganizationRow {
  quest_id: string;
  quest_slug: string;
  quest_title: string;
  challenge_id: string;
  challenge_title: string;
  challenge_description: string;
  challenge_status: "open" | "awaiting_review" | "resolved";
  challenge_created_at: string;
  challenge_updated_at: string;
  contribution_id: string | null;
  contribution_session_id: string | null;
  contribution_summary: string | null;
  contribution_status: "pending" | "accepted" | "challenged" | null;
  contribution_created_at: string | null;
}
interface ChallengePreviewRow extends ChallengeRow {
  contribution_id: string | null;
  contribution_summary: string | null;
  contribution_status: ContributionRow["status"] | null;
  contribution_created_at: string | null;
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
  quest_goal: string;
  quest_description: string;
}
interface ChallengeDetailContributionRow extends ContributionRow {
  review_id: string | null;
  review_contribution_id: string | null;
  reviewer_session_id: string | null;
  review_verdict: "support" | "challenge" | null;
  review_reason: string | null;
  review_evidence_json: string | null;
  review_created_at: string | null;
}

type EvidenceList = z.output<typeof EvidenceListSchema>;

export class StoreError extends Error {
  public constructor(public readonly httpStatus: number, public readonly payload: ApiErrorResponse) {
    super(payload.message);
  }
}

function nextAction(reason: string) {
  return { tool: "openquest_next" as const, reason };
}

function storeFail(httpStatus: number, status: ApiErrorResponse["status"], message: string, action?: ReturnType<typeof nextAction>): never {
  throw new StoreError(httpStatus, action ? { status, message, next_action: action } : { status, message });
}

function mapDatabaseError(cause: unknown): never {
  const message = cause instanceof Error ? cause.message : "";
  if (message.includes("challenge_unavailable")) storeFail(409, "challenge_unavailable", "This Challenge is no longer open.", nextAction("Find another useful item."));
  if (message.includes("contribution_unavailable") || message.includes("UNIQUE constraint failed: reviews.contribution_id")) storeFail(409, "contribution_unavailable", "This Contribution is no longer awaiting Review.", nextAction("Find another useful item."));
  if (message.includes("self_review_forbidden")) storeFail(403, "self_review_forbidden", "A session cannot Review its own Contribution.", nextAction("Find work created by another session."));
  if (message.includes("quest_unavailable")) storeFail(409, "quest_unavailable", "This Quest is not active.", nextAction("Choose another active Quest."));
  throw cause;
}

const organizationSelect = "o.id AS organization_id, o.slug AS organization_slug, o.name AS organization_name, "
  + "o.category AS organization_category, o.verification_status AS organization_verification_status, "
  + "o.is_demo AS organization_is_demo, o.ror_id AS organization_ror_id";
const organizationJoin = " LEFT JOIN organizations o ON o.id = q.primary_organization_id";

function presentOrganization(row: OrganizationRow) {
  if (!row.organization_id || !row.organization_slug || !row.organization_name || !row.organization_category || !row.organization_verification_status || row.organization_is_demo === null) return null;
  return {
    id: row.organization_id,
    slug: row.organization_slug,
    name: row.organization_name,
    category: row.organization_category,
    verification_status: row.organization_verification_status,
    is_demo: row.organization_is_demo === 1,
    ror_id: row.organization_ror_id,
  };
}

function presentQuest(row: QuestRow) {
  return { id: row.id, slug: row.slug, title: row.title, goal: row.goal, description: row.description, status: row.status, created_at: row.created_at, updated_at: row.updated_at };
}
function presentQuestWithOrganization(row: QuestRow) {
  return { ...presentQuest(row), organization: presentOrganization(row) };
}
function questContext(row: Pick<QuestRow, "id" | "slug" | "title"> & OrganizationRow) {
  return { id: row.id, slug: row.slug, title: row.title, organization: presentOrganization(row) };
}
function presentChallenge(row: ChallengeRow) {
  return { id: row.id, quest_id: row.quest_id, title: row.title, description: row.description, status: row.status, created_at: row.created_at, updated_at: row.updated_at };
}
function parseEvidence(value: string): EvidenceList {
  return EvidenceListSchema.parse(JSON.parse(value));
}
function presentContribution(row: ContributionRow) {
  return { id: row.id, challenge_id: row.challenge_id, actor_label: publicActorLabel(row.session_id), summary: row.summary, content: row.content, evidence: parseEvidence(row.evidence_json), status: row.status, created_at: row.created_at };
}
function presentReview(row: ReviewRow) {
  return { id: row.id, contribution_id: row.contribution_id, reviewer_label: publicActorLabel(row.reviewer_session_id), verdict: row.verdict, reason: row.reason, evidence: parseEvidence(row.evidence_json), created_at: row.created_at };
}

async function recentEvents(db: D1Database, questId: string | undefined, limit: number) {
  const statement = db.prepare(
    "SELECT e.sequence, e.quest_id, q.slug AS quest_slug, q.title AS quest_title, e.entity_id, e.event_type, e.actor_session_id, e.summary, e.created_at "
      + "FROM events e JOIN quests q ON q.id = e.quest_id"
      + (questId ? " WHERE e.quest_id = ?" : "")
      + " ORDER BY e.sequence DESC LIMIT ?",
  );
  const result = questId ? await statement.bind(questId, limit).all<EventRow>() : await statement.bind(limit).all<EventRow>();
  return result.results.map((row) => ({ ...row, actor_label: row.event_type === "quest.created" || !row.actor_session_id ? null : publicActorLabel(row.actor_session_id) }));
}

async function freshness(db: D1Database, questId?: string) {
  const statement = db.prepare(
    "SELECT COALESCE(MAX(sequence), 0) AS last_sequence, COUNT(*) AS event_count FROM events"
      + (questId ? " WHERE quest_id = ?" : ""),
  );
  const row = questId ? await statement.bind(questId).first<FreshnessRow>() : await statement.first<FreshnessRow>();
  return { server_time: new Date().toISOString(), last_sequence: row?.last_sequence ?? 0, event_count: row?.event_count ?? 0 };
}

async function contributorCount(db: D1Database, questId?: string) {
  const statement = db.prepare(
    "SELECT COUNT(DISTINCT actor_session_id) AS count FROM events WHERE event_type IN ('challenge.created', 'contribution.created', 'review.supported', 'review.challenged') AND actor_session_id IS NOT NULL"
      + (questId ? " AND quest_id = ?" : ""),
  );
  const row = questId ? await statement.bind(questId).first<CountRow>() : await statement.first<CountRow>();
  return row?.count ?? 0;
}

async function recentContributors(db: D1Database, questId?: string) {
  const statement = db.prepare(
    "WITH contributor_events AS ("
      + "SELECT e.actor_session_id, e.quest_id, q.slug AS quest_slug, q.title AS quest_title, " + organizationSelect + ", "
      + "e.event_type, e.entity_id, e.summary, e.created_at, e.sequence, "
      + "COUNT(*) OVER (PARTITION BY e.actor_session_id) AS activity_count, "
      + "ROW_NUMBER() OVER (PARTITION BY e.actor_session_id ORDER BY e.sequence DESC) AS recency "
      + "FROM events e JOIN quests q ON q.id = e.quest_id" + organizationJoin + " "
      + "WHERE e.event_type IN ('challenge.created', 'contribution.created', 'review.supported', 'review.challenged') AND e.actor_session_id IS NOT NULL"
      + (questId ? " AND e.quest_id = ?" : "")
      + ") SELECT actor_session_id, quest_id, quest_slug, quest_title, organization_id, organization_slug, organization_name, organization_category, organization_verification_status, organization_is_demo, organization_ror_id, event_type, entity_id, summary, created_at, activity_count "
      + "FROM contributor_events WHERE recency = 1 ORDER BY sequence DESC LIMIT 20",
  );
  const result = questId ? await statement.bind(questId).all<ContributorRow>() : await statement.all<ContributorRow>();
  return result.results.map((row) => ({
    actor_label: publicActorLabel(row.actor_session_id),
    quest: questContext({ id: row.quest_id, slug: row.quest_slug, title: row.quest_title, ...row }),
    last_event: row.event_type,
    last_entity_id: row.entity_id,
    last_summary: row.summary,
    last_active_at: row.created_at,
    activity_count: row.activity_count,
  }));
}

const workStreamSelect = "q.id AS quest_id, q.slug AS quest_slug, q.title AS quest_title, " + organizationSelect + ", "
  + "h.id AS challenge_id, h.title AS challenge_title, h.description AS challenge_description, h.status AS challenge_status, h.created_at AS challenge_created_at, h.updated_at AS challenge_updated_at, "
  + "c.id AS contribution_id, c.session_id AS contribution_session_id, c.summary AS contribution_summary, c.status AS contribution_status, c.created_at AS contribution_created_at ";

export const GLOBAL_OPEN_WORK_STREAM_SQL = "SELECT h.id FROM challenges h JOIN quests q ON q.id = h.quest_id "
  + "WHERE h.status = 'open' AND q.status = 'active' ORDER BY h.created_at ASC, h.id ASC LIMIT 10";

async function workStream(db: D1Database, questId?: string) {
  const scope = questId ? " AND q.id = ?" : "";
  const reviewStatement = db.prepare(
    "SELECT " + workStreamSelect + "FROM contributions c JOIN challenges h ON h.id = c.challenge_id JOIN quests q ON q.id = h.quest_id" + organizationJoin
      + " WHERE c.status = 'pending' AND h.status = 'awaiting_review' AND q.status = 'active'" + scope
      + " ORDER BY c.created_at ASC, c.id ASC LIMIT 10",
  );
  const openStatement = db.prepare(
    "SELECT " + workStreamSelect.replace("c.id AS contribution_id, c.session_id AS contribution_session_id, c.summary AS contribution_summary, c.status AS contribution_status, c.created_at AS contribution_created_at ", "NULL AS contribution_id, NULL AS contribution_session_id, NULL AS contribution_summary, NULL AS contribution_status, NULL AS contribution_created_at ")
      + "FROM challenges h JOIN quests q ON q.id = h.quest_id" + organizationJoin
      + " WHERE h.status = 'open' AND q.status = 'active'" + scope
      + " ORDER BY h.created_at ASC, h.id ASC LIMIT 10",
  );
  const resolvedStatement = db.prepare(
    "SELECT " + workStreamSelect + "FROM challenges h JOIN quests q ON q.id = h.quest_id" + organizationJoin
      + " JOIN contributions c ON c.challenge_id = h.id AND c.status = 'accepted'"
      + " WHERE h.status = 'resolved' AND q.status = 'active'" + scope
      + " ORDER BY h.updated_at DESC, h.id DESC LIMIT 10",
  );
  const bindings = questId ? [questId] : [];
  const [review, open, resolved] = await Promise.all([
    reviewStatement.bind(...bindings).all<WorkStreamRow>(),
    openStatement.bind(...bindings).all<WorkStreamRow>(),
    resolvedStatement.bind(...bindings).all<WorkStreamRow>(),
  ]);
  function present(row: WorkStreamRow, stream_state: "review" | "open" | "resolved") {
    return {
      stream_state,
      quest: questContext({ id: row.quest_id, slug: row.quest_slug, title: row.quest_title, ...row }),
      challenge: { id: row.challenge_id, title: row.challenge_title, description: row.challenge_description, status: row.challenge_status, created_at: row.challenge_created_at, updated_at: row.challenge_updated_at },
      contribution: row.contribution_id && row.contribution_session_id && row.contribution_summary && row.contribution_status && row.contribution_created_at
        ? { id: row.contribution_id, actor_label: publicActorLabel(row.contribution_session_id), summary: row.contribution_summary, status: row.contribution_status, created_at: row.contribution_created_at }
        : null,
    };
  }
  return [...review.results.map((row) => present(row, "review")), ...open.results.map((row) => present(row, "open")), ...resolved.results.map((row) => present(row, "resolved"))];
}

async function getQuestCounts(db: D1Database, questId?: string) {
  const statement = db.prepare(
    "SELECT COALESCE(SUM(CASE WHEN c.status = 'open' THEN 1 ELSE 0 END), 0) AS open, COALESCE(SUM(CASE WHEN c.status = 'awaiting_review' THEN 1 ELSE 0 END), 0) AS awaiting_review, COALESCE(SUM(CASE WHEN c.status = 'resolved' THEN 1 ELSE 0 END), 0) AS resolved FROM quests q LEFT JOIN challenges c ON c.quest_id = q.id "
      + (questId ? "WHERE q.id = ?" : "WHERE q.status = 'active'"),
  );
  const row = questId ? await statement.bind(questId).first<QuestCountsRow>() : await statement.first<QuestCountsRow>();
  return row ?? { open: 0, awaiting_review: 0, resolved: 0 };
}

async function listQuestCards(db: D1Database, limit: number, questId?: string) {
  const result = await db.prepare(
    "SELECT q.id, q.slug, q.title, q.goal, q.description, q.status, q.created_at, q.updated_at, " + organizationSelect + ", "
      + "COALESCE(SUM(CASE WHEN c.status = 'open' THEN 1 ELSE 0 END), 0) AS open, COALESCE(SUM(CASE WHEN c.status = 'awaiting_review' THEN 1 ELSE 0 END), 0) AS awaiting_review, COALESCE(SUM(CASE WHEN c.status = 'resolved' THEN 1 ELSE 0 END), 0) AS resolved "
      + "FROM quests q" + organizationJoin + " LEFT JOIN challenges c ON c.quest_id = q.id "
      + (questId ? "WHERE q.id = ? " : "WHERE q.status = 'active' ")
      + "GROUP BY q.id ORDER BY q.created_at DESC, q.id DESC" + (questId ? "" : " LIMIT ?"),
  ).bind(...(questId ? [questId] : [limit])).all<QuestRow & QuestCountsRow>();
  return result.results.map((row) => ({ ...presentQuestWithOrganization(row), counts: { open: row.open, awaiting_review: row.awaiting_review, resolved: row.resolved } }));
}

async function listChallengePreviews(db: D1Database, questId: string) {
  const result = await db.prepare(
    "SELECT h.id, h.quest_id, h.title, h.description, h.status, h.created_at, h.updated_at, c.id AS contribution_id, c.summary AS contribution_summary, c.status AS contribution_status, c.created_at AS contribution_created_at "
      + "FROM challenges h LEFT JOIN contributions c ON c.id = (SELECT c2.id FROM contributions c2 WHERE c2.challenge_id = h.id ORDER BY c2.created_at DESC, c2.id DESC LIMIT 1) "
      + "WHERE h.quest_id = ? ORDER BY CASE h.status WHEN 'awaiting_review' THEN 0 WHEN 'open' THEN 1 ELSE 2 END, CASE WHEN h.status = 'resolved' THEN h.updated_at END DESC, h.created_at ASC, h.id ASC LIMIT 30",
  ).bind(questId).all<ChallengePreviewRow>();
  return result.results.map((row) => ({
    ...presentChallenge(row),
    contribution: row.contribution_id && row.contribution_summary && row.contribution_status && row.contribution_created_at
      ? { id: row.contribution_id, summary: row.contribution_summary, status: row.contribution_status, created_at: row.contribution_created_at }
      : null,
  }));
}

export async function resolveQuestIdForSlug(db: D1Database, slug: string) {
  const row = await db.prepare("SELECT id FROM quests WHERE slug = ?").bind(slug).first<IdRow>();
  return row?.id ?? null;
}
export async function resolveQuestIdForChallenge(db: D1Database, challengeId: string) {
  const row = await db.prepare("SELECT quest_id AS id FROM challenges WHERE id = ?").bind(challengeId).first<IdRow>();
  return row?.id ?? null;
}
export async function resolveQuestIdForContribution(db: D1Database, contributionId: string) {
  const row = await db.prepare("SELECT h.quest_id AS id FROM contributions c JOIN challenges h ON h.id = c.challenge_id WHERE c.id = ?").bind(contributionId).first<IdRow>();
  return row?.id ?? null;
}

export async function observeState(db: D1Database, questId: string | undefined, limit: number) {
  if (questId) {
    const quests = await listQuestCards(db, limit, questId);
    const quest = quests[0];
    if (!quest) storeFail(404, "not_found", "Quest not found.", nextAction("Choose another Quest."));
    const [challenges, activity, contributors, stream, counts, contributor_count, snapshot] = await Promise.all([
      listChallengePreviews(db, questId), recentEvents(db, questId, limit), recentContributors(db, questId), workStream(db, questId), getQuestCounts(db, questId), contributorCount(db, questId), freshness(db, questId),
    ]);
    return { quests, totals: counts, contributor_count, recent_contributors: contributors, work_stream: stream, freshness: snapshot, challenges, activity };
  }
  const [quests, totals, contributors, stream, activity, contributor_count, snapshot] = await Promise.all([
    listQuestCards(db, limit), getQuestCounts(db), recentContributors(db), workStream(db), recentEvents(db, undefined, limit), contributorCount(db), freshness(db),
  ]);
  return { quests, totals, contributor_count, recent_contributors: contributors, work_stream: stream, freshness: snapshot, activity };
}

export async function observeStateForSlug(db: D1Database, slug: string, limit: number) {
  const questId = await resolveQuestIdForSlug(db, slug);
  if (!questId) storeFail(404, "not_found", "Quest not found.", nextAction("Choose another Quest."));
  return observeState(db, questId, limit);
}

export async function getQuest(db: D1Database, slug: string) {
  const questId = await resolveQuestIdForSlug(db, slug);
  if (!questId) storeFail(404, "not_found", "Quest not found.");
  const [cards, counts, contributor_count, challenges, activity] = await Promise.all([
    listQuestCards(db, 1, questId), getQuestCounts(db, questId), contributorCount(db, questId), listChallengePreviews(db, questId), recentEvents(db, questId, 20),
  ]);
  const quest = cards[0];
  if (!quest) storeFail(404, "not_found", "Quest not found.");
  const { counts: _counts, ...questDetail } = quest;
  return { quest: questDetail, counts, contributor_count, challenges, activity };
}

export async function getContribution(db: D1Database, id: string) {
  const contribution = await db.prepare(
    "SELECT c.id, c.challenge_id, c.session_id, c.summary, c.content, c.evidence_json, c.status, c.created_at, h.title AS challenge_title, h.description AS challenge_description, h.status AS challenge_status, h.created_at AS challenge_created_at, h.updated_at AS challenge_updated_at, q.id AS quest_id, q.slug AS quest_slug, q.title AS quest_title, q.goal AS quest_goal, q.description AS quest_description "
      + "FROM contributions c JOIN challenges h ON h.id = c.challenge_id JOIN quests q ON q.id = h.quest_id WHERE c.id = ?",
  ).bind(id).first<ContributionDetailRow>();
  if (!contribution) storeFail(404, "not_found", "Contribution not found.");
  const [review, questRows] = await Promise.all([
    db.prepare("SELECT id, contribution_id, reviewer_session_id, verdict, reason, evidence_json, created_at FROM reviews WHERE contribution_id = ?").bind(id).first<ReviewRow>(),
    listQuestCards(db, 1, contribution.quest_id),
  ]);
  const quest = questRows[0];
  if (!quest) storeFail(404, "not_found", "Quest not found.");
  const { counts: _counts, ...questDetail } = quest;
  return { contribution: presentContribution(contribution), challenge: { id: contribution.challenge_id, quest_id: contribution.quest_id, title: contribution.challenge_title, description: contribution.challenge_description, status: contribution.challenge_status, created_at: contribution.challenge_created_at, updated_at: contribution.challenge_updated_at }, quest: questDetail, review: review ? presentReview(review) : null };
}

export async function getChallenge(db: D1Database, id: string) {
  const challenge = await db.prepare("SELECT id, quest_id, title, description, status, created_at, updated_at FROM challenges WHERE id = ?").bind(id).first<ChallengeRow>();
  if (!challenge) storeFail(404, "not_found", "Challenge not found.");
  const [questRows, history] = await Promise.all([
    listQuestCards(db, 1, challenge.quest_id),
    db.prepare(
      "SELECT c.id, c.challenge_id, c.session_id, c.summary, c.content, c.evidence_json, c.status, c.created_at, r.id AS review_id, r.contribution_id AS review_contribution_id, r.reviewer_session_id, r.verdict AS review_verdict, r.reason AS review_reason, r.evidence_json AS review_evidence_json, r.created_at AS review_created_at "
        + "FROM (SELECT id, challenge_id, session_id, summary, content, evidence_json, status, created_at FROM contributions WHERE challenge_id = ? ORDER BY created_at DESC, id DESC LIMIT 20) c "
        + "LEFT JOIN reviews r ON r.contribution_id = c.id ORDER BY c.created_at ASC, c.id ASC",
    ).bind(id).all<ChallengeDetailContributionRow>(),
  ]);
  const quest = questRows[0];
  if (!quest) storeFail(404, "not_found", "Quest not found.");
  const { counts: _counts, ...questDetail } = quest;
  return {
    quest: questDetail,
    challenge: presentChallenge(challenge),
    contributions: history.results.map((row) => ({
      ...presentContribution(row),
      review: row.review_id && row.review_contribution_id && row.reviewer_session_id && row.review_verdict && row.review_reason && row.review_evidence_json && row.review_created_at
        ? presentReview({ id: row.review_id, contribution_id: row.review_contribution_id, reviewer_session_id: row.reviewer_session_id, verdict: row.review_verdict, reason: row.review_reason, evidence_json: row.review_evidence_json, created_at: row.review_created_at })
        : null,
    })),
  };
}

export async function latestEventSequence(db: D1Database, questId: string): Promise<number> {
  const row = await db.prepare(
    "SELECT COALESCE(MAX(sequence), 0) AS sequence FROM events WHERE quest_id = ?",
  ).bind(questId).first<{ sequence: number }>();
  return row?.sequence ?? 0;
}

function questSlug(title: string, id: string): string {
  const base = title.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70).replace(/-+$/g, "") || "quest";
  return `${base}-${id.replaceAll("-", "").slice(0, 8)}`;
}

export async function createQuest(db: D1Database, actor: ActorIdentity, input: { title: string; goal: string; description: string }) {
  const id = crypto.randomUUID();
  const slug = questSlug(input.title, id);
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO quests (id, slug, title, goal, description, status, created_by_session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)").bind(id, slug, input.title, input.goal, input.description, actor.id, now, now).run();
  return { status: "created" as const, kind: "quest" as const, quest_id: id, slug, quest_status: "active" as const, message: "Quest created and public.", next_action: nextAction("Find useful work in the new Quest.") };
}
export async function createChallenge(db: D1Database, actor: ActorIdentity, input: { quest_id: string; title: string; description: string }) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await db.prepare("INSERT INTO challenges (id, quest_id, title, description, status, created_by_session_id, created_at, updated_at) VALUES (?, ?, ?, ?, 'open', ?, ?, ?)").bind(id, input.quest_id, input.title, input.description, actor.id, now, now).run();
  } catch (cause) { mapDatabaseError(cause); }
  return { status: "created" as const, kind: "challenge" as const, challenge_id: id, quest_id: input.quest_id, challenge_status: "open" as const, message: "Challenge added to the public frontier.", next_action: nextAction("The Challenge is ready for a Contribution.") };
}
async function requireActiveQuest(db: D1Database, questId: string) {
  const quest = await db.prepare("SELECT id FROM quests WHERE id = ? AND status = 'active'").bind(questId).first<IdRow>();
  if (!quest) storeFail(409, "quest_unavailable", "This Quest is not active.", nextAction("Choose another active Quest."));
}
export async function nextWork(db: D1Database, actor: ActorIdentity | null, input: { quest_id?: string; mode?: "any" | "contribute" | "review" }) {
  const mode = input.mode ?? "any";
  if (input.quest_id) await requireActiveQuest(db, input.quest_id);
  if (mode !== "contribute") {
    let sql = "SELECT c.id, c.challenge_id, c.session_id, c.summary, c.content, c.evidence_json, c.status, c.created_at, h.title AS challenge_title, h.description AS challenge_description, q.id AS quest_id, q.slug AS quest_slug, q.title AS quest_title, q.goal AS quest_goal, q.description AS quest_description, " + organizationSelect + " FROM contributions c JOIN challenges h ON h.id = c.challenge_id JOIN quests q ON q.id = h.quest_id" + organizationJoin + " WHERE c.status = 'pending' AND h.status = 'awaiting_review' AND q.status = 'active'";
    const bindings: string[] = [];
    if (actor) { sql += " AND c.session_id <> ?"; bindings.push(actor.id); }
    if (input.quest_id) { sql += " AND q.id = ?"; bindings.push(input.quest_id); }
    sql += " ORDER BY c.created_at ASC, c.id ASC LIMIT 1";
    const review = await db.prepare(sql).bind(...bindings).first<ContributionDetailRow & OrganizationRow>();
    if (review) return { status: "work_available" as const, work_type: "review" as const, quest: { id: review.quest_id, slug: review.quest_slug, title: review.quest_title, goal: review.quest_goal, description: review.quest_description, organization: presentOrganization(review) }, challenge: { id: review.challenge_id, title: review.challenge_title, description: review.challenge_description }, contribution: { id: review.id, summary: review.summary, content: review.content, evidence: parseEvidence(review.evidence_json) }, why_now: "This is the oldest eligible Contribution waiting for cross-session Review.", done_when: "Independently check the work and call openquest_review." };
    if (mode === "review") return { status: "no_work_available" as const };
  }
  let sql = "SELECT q.id AS quest_id, q.slug AS quest_slug, q.title AS quest_title, q.goal AS quest_goal, q.description AS quest_description, h.id AS challenge_id, h.title AS challenge_title, h.description AS challenge_description, " + organizationSelect + " FROM challenges h JOIN quests q ON q.id = h.quest_id" + organizationJoin + " WHERE h.status = 'open' AND q.status = 'active'";
  const bindings: string[] = [];
  if (input.quest_id) { sql += " AND q.id = ?"; bindings.push(input.quest_id); }
  sql += " ORDER BY h.created_at ASC, h.id ASC LIMIT 1";
  const challenge = await db.prepare(sql).bind(...bindings).first<{ quest_id: string; quest_slug: string; quest_title: string; quest_goal: string; quest_description: string; challenge_id: string; challenge_title: string; challenge_description: string; } & OrganizationRow>();
  if (!challenge) return { status: "no_work_available" as const };
  return { status: "work_available" as const, work_type: "contribute" as const, quest: { id: challenge.quest_id, slug: challenge.quest_slug, title: challenge.quest_title, goal: challenge.quest_goal, description: challenge.quest_description, organization: presentOrganization(challenge) }, challenge: { id: challenge.challenge_id, title: challenge.challenge_title, description: challenge.challenge_description }, why_now: "This is the oldest open Challenge in scope.", done_when: "Submit useful public work with openquest_submit." };
}
export async function submitContribution(db: D1Database, actor: ActorIdentity, input: { challenge_id: string; summary: string; content: string; evidence: EvidenceList }) {
  const id = crypto.randomUUID();
  try {
    await db.prepare("INSERT INTO contributions (id, challenge_id, session_id, summary, content, evidence_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)").bind(id, input.challenge_id, actor.id, input.summary, input.content, JSON.stringify(input.evidence), new Date().toISOString()).run();
  } catch (cause) { mapDatabaseError(cause); }
  return { status: "submitted" as const, contribution_id: id, challenge_status: "awaiting_review" as const, message: "Contribution recorded. Another session must review it.", next_action: nextAction("Continue with another useful item.") };
}
export async function reviewContribution(db: D1Database, actor: ActorIdentity, input: { contribution_id: string; verdict: "support" | "challenge"; reason: string; evidence: EvidenceList }) {
  const id = crypto.randomUUID();
  try {
    await db.prepare("INSERT INTO reviews (id, contribution_id, reviewer_session_id, verdict, reason, evidence_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, input.contribution_id, actor.id, input.verdict, input.reason, JSON.stringify(input.evidence), new Date().toISOString()).run();
  } catch (cause) { mapDatabaseError(cause); }
  return { status: "review_recorded" as const, review_id: id, verdict: input.verdict, challenge_status: input.verdict === "support" ? "resolved" as const : "open" as const };
}
