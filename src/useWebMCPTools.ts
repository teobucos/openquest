import { useEffect, useReducer, useState } from "react";
import type { ZodType } from "zod";
import {
  ApiError,
  getNextWork,
  observeMissions,
  proposeNeed,
  reviewContribution,
  submitContribution,
} from "./api";
import {
  GetNextWorkInputSchema,
  ObserveMissionsInputSchema,
  ProposeNeedInputSchema,
  ReviewContributionInputSchema,
  SubmitContributionInputSchema,
  WebMCPToolInputJsonSchemas,
  type ObserveMissionsResponse,
} from "./contracts";

const readAnnotations = {
  readOnlyHint: true,
  untrustedContentHint: true,
} as const;

const writeAnnotations = {
  readOnlyHint: false,
} as const;

export interface WebMCPToolsState {
  error: string | null;
  registered: boolean;
  supported: boolean;
}

function textResult<Value>(value: Value): WebMCPToolResult {
  return {
    content: [{ text: JSON.stringify(value), type: "text" }],
  };
}

function errorResult(message: string): WebMCPToolResult {
  return {
    content: [{ text: message, type: "text" }],
    isError: true,
  };
}

function failureMessage(cause: unknown): string {
  if (cause instanceof ApiError) return cause.message;
  if (cause instanceof Error) {
    return cause.message || "OpenShare could not complete that action. Please refresh shared state and try again.";
  }
  return "Invalid input.";
}

type ChangeAction = "contribution" | "need" | "review";

function dispatchChange(action: ChangeAction): void {
  window.dispatchEvent(
    new CustomEvent("openshare:changed", {
      detail: { action },
    }),
  );
}

async function executeTool<Input, Result>(
  schema: ZodType<Input>,
  input: WebMCPInput,
  execute: (parsed: Input, signal: AbortSignal) => Promise<Result>,
  controllerSignal: AbortSignal,
  callSignal?: AbortSignal,
  change?: ChangeAction,
): Promise<WebMCPToolResult> {
  try {
    const signal = callSignal
      ? AbortSignal.any([controllerSignal, callSignal])
      : controllerSignal;
    const result = await execute(schema.parse(input), signal);
    if (change) dispatchChange(change);
    return textResult(result);
  } catch (cause) {
    return errorResult(failureMessage(cause));
  }
}

function bindTool<Input, Result>(
  schema: ZodType<Input>,
  execute: (parsed: Input, signal: AbortSignal) => Promise<Result>,
  controllerSignal: AbortSignal,
  change?: ChangeAction,
): WebMCPTool["execute"] {
  return (input, options) =>
    executeTool(schema, input, execute, controllerSignal, options?.signal, change);
}

function presentObservation(result: ObserveMissionsResponse) {
  return {
    activity: result.activity.map((event) => ({
      created_at: event.created_at,
      entity_id: event.entity_id,
      event_type: event.event_type,
      mission_id: event.mission_id,
      sequence: event.sequence,
    })),
    missions: result.missions.map((mission) => ({
      counts: mission.counts,
      id: mission.id,
      progress: mission.progress,
      slug: mission.slug,
      status: mission.status,
      title: mission.title,
      type: mission.type,
    })),
    suggested_next: result.suggested_next,
    totals: result.totals,
  };
}

export function useWebMCPTools(): WebMCPToolsState {
  const [detectionVersion, redetect] = useReducer((version: number) => version + 1, 0);
  const [state, setState] = useState<WebMCPToolsState>({
    error: null,
    registered: false,
    supported: false,
  });

  useEffect(() => {
    const context = document.modelContext;
    if (!context) {
      setState({ error: null, registered: false, supported: false });
      let attempts = 0;
      const timer = window.setInterval(() => {
        if (document.modelContext) {
          window.clearInterval(timer);
          redetect();
          return;
        }
        attempts += 1;
        if (attempts >= 20) window.clearInterval(timer);
      }, 500);
      return () => window.clearInterval(timer);
    }

    const controller = new AbortController();
    setState({ error: null, registered: false, supported: true });

    const tools: WebMCPTool[] = [
      {
        annotations: readAnnotations,
        description:
          "Inspect current OpenShare missions, needs, contributions, and cross-session review progress.",
        execute: bindTool(
          ObserveMissionsInputSchema,
          async (input, signal) => presentObservation(await observeMissions(input, signal)),
          controller.signal,
        ),
        inputSchema: WebMCPToolInputJsonSchemas.observe_missions,
        name: "observe_missions",
      },
      {
        annotations: readAnnotations,
        description:
          "Return one useful open Need or pending Contribution to work on without changing shared state.",
        execute: bindTool(GetNextWorkInputSchema, getNextWork, controller.signal),
        inputSchema: WebMCPToolInputJsonSchemas.get_next_work,
        name: "get_next_work",
      },
      {
        annotations: writeAnnotations,
        description:
          "Submit a bounded evidence-backed contribution for one open OpenShare Need.",
        execute: bindTool(
          SubmitContributionInputSchema,
          submitContribution,
          controller.signal,
          "contribution",
        ),
        inputSchema: WebMCPToolInputJsonSchemas.submit_contribution,
        name: "submit_contribution",
      },
      {
        annotations: writeAnnotations,
        description:
          "Review another browser session's contribution and support, challenge, or request more work.",
        execute: bindTool(
          ReviewContributionInputSchema,
          reviewContribution,
          controller.signal,
          "review",
        ),
        inputSchema: WebMCPToolInputJsonSchemas.review_contribution,
        name: "review_contribution",
      },
      {
        annotations: writeAnnotations,
        description:
          "Propose a specific, bounded new Need that would advance an existing OpenShare mission.",
        execute: bindTool(ProposeNeedInputSchema, proposeNeed, controller.signal, "need"),
        inputSchema: WebMCPToolInputJsonSchemas.propose_need,
        name: "propose_need",
      },
    ];

    void Promise.all(
      tools.map((tool) => context.registerTool(tool, { signal: controller.signal })),
    )
      .then(() => {
        if (!controller.signal.aborted) {
          setState({ error: null, registered: true, supported: true });
        }
      })
      .catch((caught) => {
        if (controller.signal.aborted) return;
        controller.abort();
        const message = caught instanceof Error ? caught.message : "WebMCP tool registration failed.";
        setState({ error: message, registered: false, supported: true });
      });

    return () => controller.abort();
  }, [detectionVersion]);

  return state;
}
