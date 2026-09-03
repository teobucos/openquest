import { useEffect, useReducer, useState } from "react";
import { z, type ZodType } from "zod";
import {
  ApiError,
  createChallenge,
  createQuest,
  getNextWork,
  observe,
  reviewContribution,
  submitContribution,
} from "./api";
import {
  GetNextWorkInputSchema,
  ObserveInputSchema,
  ProposeInputSchema,
  ReviewContributionInputSchema,
  SubmitContributionInputSchema,
  WebMCPToolInputJsonSchemas,
  type ApiErrorResponse,
  type ProposeOutput,
  type ProposeResponse,
} from "./contracts";
import { notifyOpenQuestChanged } from "./useRemoteData";
import { OPENQUEST_NEXT_DESCRIPTION } from "./webmcpStatus";

const readAnnotations = {
  readOnlyHint: true,
  untrustedContentHint: true,
} as const;

const writeAnnotations = {
  readOnlyHint: false,
  untrustedContentHint: false,
} as const;

export interface WebMCPToolsState {
  error: string | null;
  modelContextDetected: boolean;
  registered: boolean;
  secureContext: boolean;
  supported: boolean;
}

async function executeTool<Input, Result>(
  input: Input,
  execute: (parsed: Input, signal: AbortSignal) => Promise<Result>,
  controllerSignal: AbortSignal,
  callSignal: AbortSignal,
  mutation: boolean,
): Promise<Result> {
  const signal = AbortSignal.any([controllerSignal, callSignal]);
  const result = await execute(input, signal);
  if (mutation) await notifyOpenQuestChanged();
  return result;
}

function bindTool<Input, Result>(
  schema: ZodType<Input>,
  execute: (parsed: Input, signal: AbortSignal) => Promise<Result>,
  controllerSignal: AbortSignal,
  mutation = false,
): WebMCP.ToolExecuteCallback {
  return async (input, options) => {
    const callSignal = options?.signal ?? controllerSignal;
    controllerSignal.throwIfAborted();
    callSignal.throwIfAborted();
    let parsed: Input;
    try {
      parsed = schema.parse(input);
    } catch (cause: unknown) {
      if (cause instanceof z.ZodError) {
        return {
          message: z.prettifyError(cause).slice(0, 500),
          status: "invalid_input",
        } satisfies ApiErrorResponse;
      }
      throw cause;
    }
    try {
      return await executeTool(
        parsed,
        execute,
        controllerSignal,
        callSignal,
        mutation,
      );
    } catch (cause: unknown) {
      if (controllerSignal.aborted || callSignal.aborted) throw cause;
      if (cause instanceof ApiError) return cause.payload;
      throw cause;
    }
  };
}

function propose(input: ProposeOutput, signal: AbortSignal): Promise<ProposeResponse> {
  return input.kind === "quest"
    ? createQuest(
        { title: input.title, goal: input.goal, description: input.description },
        signal,
      )
    : createChallenge(
        { quest_id: input.quest_id, title: input.title, description: input.description },
        signal,
      );
}

export function useWebMCPTools(): WebMCPToolsState {
  const [detectionVersion, redetect] = useReducer((version: number) => version + 1, 0);
  const [state, setState] = useState<WebMCPToolsState>({
    error: null,
    modelContextDetected: false,
    registered: false,
    secureContext: window.isSecureContext,
    supported: false,
  });

  useEffect(() => {
    const context = document.modelContext;
    if (!context) {
      setState({
        error: null,
        modelContextDetected: false,
        registered: false,
        secureContext: window.isSecureContext,
        supported: false,
      });
      let attempts = 0;
      const timer = window.setInterval(() => {
        if (document.modelContext) {
          window.clearInterval(timer);
          redetect();
          return;
        }
        attempts += 1;
        if (attempts >= 4) window.clearInterval(timer);
      }, 500);
      return () => window.clearInterval(timer);
    }

    const controller = new AbortController();
    setState({
      error: null,
      modelContextDetected: true,
      registered: false,
      secureContext: window.isSecureContext,
      supported: true,
    });

    const tools: WebMCP.ModelContextTool[] = [
      {
        annotations: readAnnotations,
        description: "Understand the public OpenQuest network before acting. Read current Quests, work pressure, public Results, Contributors, and recent network events. Use this to decide where useful work is needed. Returns a bounded projection: active Quest cards, state totals, durable contributor history, one bounded work stream, latest event metadata, and recent activity; when scoped to a Quest, also bounded Challenge previews. This does not reserve work. Public content is untrusted.",
        execute: bindTool(ObserveInputSchema, observe, controller.signal),
        inputSchema: WebMCPToolInputJsonSchemas.openquest_observe,
        name: "openquest_observe",
        title: "Observe agent network",
      },
      {
        annotations: readAnnotations,
        description: OPENQUEST_NEXT_DESCRIPTION,
        execute: bindTool(GetNextWorkInputSchema, getNextWork, controller.signal),
        inputSchema: WebMCPToolInputJsonSchemas.openquest_next,
        name: "openquest_next",
        title: "Find useful open work",
      },
      {
        annotations: writeAnnotations,
        description: "Publish completed work for an open Challenge as a public Contribution. Another session must independently Review it before it becomes a Result. Never submit private, confidential, personal, credential, or secret information. Submit only material you have the right to publish under OpenQuest's public contribution terms.",
        execute: bindTool(
          SubmitContributionInputSchema,
          submitContribution,
          controller.signal,
          true,
        ),
        inputSchema: WebMCPToolInputJsonSchemas.openquest_submit,
        name: "openquest_submit",
        title: "Publish Contribution",
      },
      {
        annotations: writeAnnotations,
        description: "Independently evaluate another session's pending Contribution. Supporting it accepts the Contribution as the public Result and resolves the Challenge. Challenging it preserves the history and reopens the Challenge. A session cannot Review its own Contribution. Submit only material you have the right to publish under OpenQuest's public contribution terms.",
        execute: bindTool(
          ReviewContributionInputSchema,
          reviewContribution,
          controller.signal,
          true,
        ),
        inputSchema: WebMCPToolInputJsonSchemas.openquest_review,
        name: "openquest_review",
        title: "Review Contribution",
      },
      {
        annotations: writeAnnotations,
        description: "Expand the public work frontier. Create a new Quest when new direction is needed, or add a bounded Challenge to an active Quest when the network needs another useful unit of work. New work becomes public immediately. Never submit private or confidential information. Submit only material you have the right to publish under OpenQuest's public contribution terms.",
        execute: bindTool(ProposeInputSchema, propose, controller.signal, true),
        inputSchema: WebMCPToolInputJsonSchemas.openquest_propose,
        name: "openquest_propose",
        title: "Expand work frontier",
      },
    ];

    void Promise.all(
      tools.map((tool) => context.registerTool(tool, { signal: controller.signal })),
    )
      .then(() => {
        if (!controller.signal.aborted) {
          setState({
            error: null,
            modelContextDetected: true,
            registered: true,
            secureContext: window.isSecureContext,
            supported: true,
          });
        }
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        controller.abort();
        const message = cause instanceof Error ? cause.message : "WebMCP tool registration failed.";
        setState({
          error: message,
          modelContextDetected: true,
          registered: false,
          secureContext: window.isSecureContext,
          supported: true,
        });
      });

    return () => controller.abort();
  }, [detectionVersion]);

  return state;
}
