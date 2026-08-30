import { z } from "zod";
import {
  ApiErrorResponseSchema,
  ContributionResponseSchema,
  GetNextWorkResponseSchema,
  MissionResponseSchema,
  ObserveMissionsResponseSchema,
  ProposeNeedResponseSchema,
  ReviewContributionResponseSchema,
  SubmitContributionResponseSchema,
  type ApiErrorResponse,
  type ContributionResponse,
  type GetNextWorkInput,
  type GetNextWorkResponse,
  type MissionResponse,
  type ObserveMissionsInput,
  type ObserveMissionsResponse,
  type ProposeNeedInput,
  type ProposeNeedResponse,
  type ReviewContributionInput,
  type ReviewContributionResponse,
  type SubmitContributionInput,
  type SubmitContributionResponse,
  type WorldResponse,
} from "./contracts";

export class ApiError extends Error {
  public constructor(
    public readonly status: number,
    message: string,
    public readonly code?: ApiErrorResponse["status"],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions {
  body?: string;
  method?: "POST";
  signal?: AbortSignal;
}

async function request<Response>(
  path: string,
  schema: z.ZodType<Response>,
  options: RequestOptions = {},
): Promise<Response> {
  const response = await fetch(path, {
    body: options.body,
    credentials: "same-origin",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    method: options.method ?? "GET",
    signal: options.signal,
  });

  if (!response.ok) {
    const parsed = ApiErrorResponseSchema.safeParse(await response.json());
    throw new ApiError(
      response.status,
      parsed.success
        ? parsed.data.message
        : `OpenShare request failed with HTTP ${response.status}.`,
      parsed.success ? parsed.data.status : undefined,
    );
  }

  return schema.parse(await response.json());
}

function postBody<Value>(value: Value, signal?: AbortSignal): RequestOptions {
  return { body: JSON.stringify(value), method: "POST", signal };
}

function missionQuery(missionId: string | undefined, limit?: number): string {
  const parameters = new URLSearchParams();
  if (missionId) parameters.set("mission_id", missionId);
  if (limit) parameters.set("limit", String(limit));
  const query = parameters.toString();
  return query ? "/api/world?" + query : "/api/world";
}

export function getWorld(missionId?: string, signal?: AbortSignal): Promise<WorldResponse> {
  return request(missionQuery(missionId), ObserveMissionsResponseSchema, { signal });
}

export function getMission(slug: string, signal?: AbortSignal): Promise<MissionResponse> {
  return request(`/api/missions/${encodeURIComponent(slug)}`, MissionResponseSchema, { signal });
}

export function getContribution(id: string, signal?: AbortSignal): Promise<ContributionResponse> {
  return request(`/api/contributions/${encodeURIComponent(id)}`, ContributionResponseSchema, { signal });
}

export function observeMissions(
  input: ObserveMissionsInput,
  signal?: AbortSignal,
): Promise<ObserveMissionsResponse> {
  return request(missionQuery(input.mission_id, input.limit), ObserveMissionsResponseSchema, { signal });
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
  return request("/api/reviews", ReviewContributionResponseSchema, postBody(input, signal));
}

export function proposeNeed(
  input: ProposeNeedInput,
  signal?: AbortSignal,
): Promise<ProposeNeedResponse> {
  return request("/api/needs", ProposeNeedResponseSchema, postBody(input, signal));
}
