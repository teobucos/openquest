import { useEffect, useReducer, useState } from "react";
import {
  ApiError,
  getNextWork,
  observeMissions,
  proposeNeed,
  reviewContribution,
  submitContribution,
} from "./api";
import {
  nextWorkInputSchema,
  observeMissionsInputSchema,
  proposeNeedInputSchema,
  reviewContributionInputSchema,
  submitContributionInputSchema,
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

function failureMessage(caught: Error): string {
  if (caught instanceof ApiError) return caught.message;
  return caught.message || "OpenShare could not complete that action. Please refresh shared state and try again.";
}

function dispatchChange(action: "contribution" | "need" | "review"): void {
  window.dispatchEvent(
    new CustomEvent("openshare:changed", {
      detail: { action },
    }),
  );
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

    function executionSignal(callSignal?: AbortSignal): AbortSignal {
      return callSignal
        ? AbortSignal.any([controller.signal, callSignal])
        : controller.signal;
    }

    const tools: WebMCPTool[] = [
      {
        annotations: readAnnotations,
        description:
          "Inspect current OpenShare missions, needs, contributions, and cross-session review progress.",
        async execute(input, options) {
          try {
            const parsed = observeMissionsInputSchema.parse(input);
            return textResult(presentObservation(await observeMissions(parsed, executionSignal(options?.signal))));
          } catch (caught) {
            return errorResult(failureMessage(caught instanceof Error ? caught : new Error("Invalid input.")));
          }
        },
        inputSchema: WebMCPToolInputJsonSchemas.observe_missions,
        name: "observe_missions",
      },
      {
        annotations: readAnnotations,
        description:
          "Return one useful open Need or pending Contribution to work on without changing shared state.",
        async execute(input, options) {
          try {
            const parsed = nextWorkInputSchema.parse(input);
            return textResult(await getNextWork(parsed, executionSignal(options?.signal)));
          } catch (caught) {
            return errorResult(failureMessage(caught instanceof Error ? caught : new Error("Invalid input.")));
          }
        },
        inputSchema: WebMCPToolInputJsonSchemas.get_next_work,
        name: "get_next_work",
      },
      {
        annotations: writeAnnotations,
        description:
          "Submit a bounded evidence-backed contribution for one open OpenShare Need.",
        async execute(input, options) {
          try {
            const parsed = submitContributionInputSchema.parse(input);
            const result = await submitContribution(parsed, executionSignal(options?.signal));
            dispatchChange("contribution");
            return textResult(result);
          } catch (caught) {
            return errorResult(failureMessage(caught instanceof Error ? caught : new Error("Invalid input.")));
          }
        },
        inputSchema: WebMCPToolInputJsonSchemas.submit_contribution,
        name: "submit_contribution",
      },
      {
        annotations: writeAnnotations,
        description:
          "Review another browser session's contribution and support, challenge, or request more work.",
        async execute(input, options) {
          try {
            const parsed = reviewContributionInputSchema.parse(input);
            const result = await reviewContribution(parsed, executionSignal(options?.signal));
            dispatchChange("review");
            return textResult(result);
          } catch (caught) {
            return errorResult(failureMessage(caught instanceof Error ? caught : new Error("Invalid input.")));
          }
        },
        inputSchema: WebMCPToolInputJsonSchemas.review_contribution,
        name: "review_contribution",
      },
      {
        annotations: writeAnnotations,
        description:
          "Propose a specific, bounded new Need that would advance an existing OpenShare mission.",
        async execute(input, options) {
          try {
            const parsed = proposeNeedInputSchema.parse(input);
            const result = await proposeNeed(parsed, executionSignal(options?.signal));
            dispatchChange("need");
            return textResult(result);
          } catch (caught) {
            return errorResult(failureMessage(caught instanceof Error ? caught : new Error("Invalid input.")));
          }
        },
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
