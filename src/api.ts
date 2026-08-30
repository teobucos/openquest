import { z } from "zod";
import {
  ApiErrorResponseSchema,
  ContributionResponseSchema,
  CreateChallengeResponseSchema,
  CreateQuestResponseSchema,
  GetNextWorkResponseSchema,
  ObserveQuestsResponseSchema,
  QuestResponseSchema,
  ReviewContributionResponseSchema,
  SubmitContributionResponseSchema,
  type ApiErrorResponse,
  type ContributionResponse,
  type CreateChallengeInput,
  type CreateChallengeResponse,
  type CreateQuestInput,
  type CreateQuestResponse,
  type GetNextWorkInput,
  type GetNextWorkResponse,
  type ObserveQuestsInput,
  type ObserveQuestsResponse,
  type ProposeInput,
  type ProposeResponse,
  type QuestResponse,
  type ReviewContributionInput,
  type ReviewContributionResponse,
  type SubmitContributionInput,
  type SubmitContributionResponse,
  type WorldResponse,
} from "./contracts";

export class ApiError extends Error {
  public constructor(
    public readonly httpStatus: number,
    public readonly payload: ApiErrorResponse,
  ) {
    super(payload.message);
    this.name = "ApiError";
  }
}

interface RequestOptions {
  body?: string;
  method?: "POST";
  signal?: AbortSignal;
}

async function request<ResponseValue>(
  path: string,
  schema: z.ZodType<ResponseValue>,
  options: RequestOptions = {},
): Promise<ResponseValue> {
  const response = await fetch(path, {
    body: options.body,
    credentials: "same-origin",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    method: options.method ?? "GET",
    signal: options.signal,
  });
  const body = await response.json();
  if (!response.ok) {
    const parsed = ApiErrorResponseSchema.safeParse(body);
    throw new ApiError(
      response.status,
      parsed.success
        ? parsed.data
        : { status: "error", message: `OpenQuest request failed with HTTP ${response.status}.` },
    );
  }
  return schema.parse(body);
}

function postBody<Value>(value: Value, signal?: AbortSignal): RequestOptions {
  return { body: JSON.stringify(value), method: "POST", signal };
}

function worldQuery(questId: string | undefined, limit?: number): string {
  const parameters = new URLSearchParams();
  if (questId) parameters.set("quest_id", questId);
  if (limit) parameters.set("limit", String(limit));
  const query = parameters.toString();
  return query ? `/api/world?${query}` : "/api/world";
}

export function getWorld(questId?: string, signal?: AbortSignal): Promise<WorldResponse> {
  return request(worldQuery(questId), ObserveQuestsResponseSchema, { signal });
}

export function getQuest(slug: string, signal?: AbortSignal): Promise<QuestResponse> {
  return request(`/api/quests/${encodeURIComponent(slug)}`, QuestResponseSchema, { signal });
}

export function getContribution(
  id: string,
  signal?: AbortSignal,
): Promise<ContributionResponse> {
  return request(
    `/api/contributions/${encodeURIComponent(id)}`,
    ContributionResponseSchema,
    { signal },
  );
}

export function observeQuests(
  input: ObserveQuestsInput,
  signal?: AbortSignal,
): Promise<ObserveQuestsResponse> {
  return request(
    worldQuery(input.quest_id, input.limit),
    ObserveQuestsResponseSchema,
    { signal },
  );
}

export function createQuest(
  input: CreateQuestInput,
  signal?: AbortSignal,
): Promise<CreateQuestResponse> {
  return request("/api/quests", CreateQuestResponseSchema, postBody(input, signal));
}

export function createChallenge(
  input: CreateChallengeInput,
  signal?: AbortSignal,
): Promise<CreateChallengeResponse> {
  return request("/api/challenges", CreateChallengeResponseSchema, postBody(input, signal));
}

export function getNextWork(
  input: GetNextWorkInput,
  signal?: AbortSignal,
): Promise<GetNextWorkResponse> {
  return request("/api/work/next", GetNextWorkResponseSchema, postBody(input, signal));
}

export function submitContribution(
  input: SubmitContributionInput,
  signal?: AbortSignal,
): Promise<SubmitContributionResponse> {
  return request(
    "/api/contributions",
    SubmitContributionResponseSchema,
    postBody(input, signal),
  );
}

export function reviewContribution(
  input: ReviewContributionInput,
  signal?: AbortSignal,
): Promise<ReviewContributionResponse> {
  return request(
    "/api/reviews",
    ReviewContributionResponseSchema,
    postBody(input, signal),
  );
}

export function propose(
  input: ProposeInput,
  signal?: AbortSignal,
): Promise<ProposeResponse> {
  if (input.kind === "quest") {
    return createQuest(
      { title: input.title, goal: input.goal, description: input.description },
      signal,
    );
  }
  return createChallenge(
    {
      quest_id: input.quest_id,
      title: input.title,
      description: input.description,
      parent_challenge_id: input.parent_challenge_id,
    },
    signal,
  );
}
