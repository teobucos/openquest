import { z } from "zod";
import {
  CreateChallengeInputSchema,
  CreateQuestInputSchema,
  GetNextWorkInputSchema,
  ReviewContributionInputSchema,
  SubmitContributionInputSchema,
  type ApiErrorResponse,
} from "./contracts";
import {
  actorRateLimitKey,
  addressRateLimitKey,
  consumeRateLimit,
  ensureIdentity,
  readIdentity,
} from "./identity";
import {
  StoreError,
  createChallenge,
  createQuest,
  getChallenge,
  getContribution,
  getQuest,
  nextWork,
  observeState,
  observeStateForSlug,
  reviewContribution,
  submitContribution,
} from "./store";

export interface Env {
  DB: D1Database;
}

const worldLimitSchema = z.coerce.number().int().min(1).max(20).default(10);
const identifierQuerySchema = z.string().trim().min(1).max(128).optional();
const slugQuerySchema = z.string().trim().min(3).max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .optional();

class HttpError extends Error {
  public constructor(
    public readonly httpStatus: number,
    public readonly payload: ApiErrorResponse,
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
  throw new HttpError(httpStatus, action ? { status, message, next_action: action } : { status, message });
}

function json<Value>(value: Value, status = 200, setCookie?: string | null): Response {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  if (setCookie) headers.append("set-cookie", setCookie);
  return new Response(JSON.stringify(value), { status, headers });
}

async function parseBody<Input>(request: Request, schema: z.ZodType<Input>): Promise<Input> {
  let body: unknown;
  try {
    body = await request.json();
  } catch (cause) {
    if (cause instanceof SyntaxError) {
      fail(400, "invalid_input", "Request body must be valid JSON.");
    }
    throw cause;
  }
  return schema.parse(body);
}

async function writeIdentity(request: Request, env: Env) {
  const addressBucket = await addressRateLimitKey(request);
  if (!await consumeRateLimit(env.DB, addressBucket)) {
    fail(429, "rate_limited", "Anonymous write limit reached. Try again after one minute.");
  }
  const identity = await ensureIdentity(request, env.DB);
  if (!await consumeRateLimit(env.DB, actorRateLimitKey(identity.actor))) {
    fail(429, "rate_limited", "Anonymous write limit reached. Try again after one minute.");
  }
  return identity;
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/world") {
    const limit = worldLimitSchema.parse(url.searchParams.get("limit") ?? undefined);
    const questId = identifierQuerySchema.parse(url.searchParams.get("quest_id") ?? undefined);
    const questSlug = slugQuerySchema.parse(url.searchParams.get("quest_slug") ?? undefined);
    if (questId && questSlug) fail(400, "invalid_input", "Use either quest_id or quest_slug, not both.");
    return json(questSlug
      ? await observeStateForSlug(env.DB, questSlug, limit)
      : await observeState(env.DB, questId, limit));
  }

  const questMatch = /^\/api\/quests\/([^/]+)$/.exec(url.pathname);
  if (request.method === "GET" && questMatch) {
    return json(await getQuest(env.DB, decodeURIComponent(questMatch[1])));
  }

  const contributionMatch = /^\/api\/contributions\/([^/]+)$/.exec(url.pathname);
  if (request.method === "GET" && contributionMatch) {
    return json(await getContribution(env.DB, decodeURIComponent(contributionMatch[1])));
  }

  const challengeMatch = /^\/api\/challenges\/([^/]+)$/.exec(url.pathname);
  if (request.method === "GET" && challengeMatch) {
    return json(await getChallenge(env.DB, decodeURIComponent(challengeMatch[1])));
  }

  if (request.method === "POST" && url.pathname === "/api/work/next") {
    const input = await parseBody(request, GetNextWorkInputSchema);
    return json(await nextWork(env.DB, await readIdentity(request, env.DB), input));
  }

  if (request.method === "POST" && url.pathname === "/api/quests") {
    const input = await parseBody(request, CreateQuestInputSchema);
    const identity = await writeIdentity(request, env);
    return json(await createQuest(env.DB, identity.actor, input), 201, identity.setCookie);
  }

  if (request.method === "POST" && url.pathname === "/api/challenges") {
    const input = await parseBody(request, CreateChallengeInputSchema);
    const identity = await writeIdentity(request, env);
    return json(await createChallenge(env.DB, identity.actor, input), 201, identity.setCookie);
  }

  if (request.method === "POST" && url.pathname === "/api/contributions") {
    const input = await parseBody(request, SubmitContributionInputSchema);
    const identity = await writeIdentity(request, env);
    return json(await submitContribution(env.DB, identity.actor, input), 201, identity.setCookie);
  }

  if (request.method === "POST" && url.pathname === "/api/reviews") {
    const input = await parseBody(request, ReviewContributionInputSchema);
    const identity = await writeIdentity(request, env);
    return json(await reviewContribution(env.DB, identity.actor, input), 201, identity.setCookie);
  }

  fail(404, "not_found", "API route not found.");
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  try {
    return await handleApi(request, env);
  } catch (cause) {
    if (cause instanceof HttpError || cause instanceof StoreError) {
      return json(cause.payload, cause.httpStatus);
    }
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
