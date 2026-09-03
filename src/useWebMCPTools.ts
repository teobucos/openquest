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
  type ApiErrorResponse,
  type ProposeOutput,
  type ProposeResponse,
} from "./contracts";
import { notifyOpenQuestChanged } from "./useRemoteData";
import { OPENQUEST_WEBMCP_TOOLS } from "./webmcpTools";

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

    const executeByName = {
      openquest_observe: bindTool(ObserveInputSchema, observe, controller.signal),
      openquest_next: bindTool(GetNextWorkInputSchema, getNextWork, controller.signal),
      openquest_submit: bindTool(
        SubmitContributionInputSchema,
        submitContribution,
        controller.signal,
        true,
      ),
      openquest_review: bindTool(
        ReviewContributionInputSchema,
        reviewContribution,
        controller.signal,
        true,
      ),
      openquest_propose: bindTool(ProposeInputSchema, propose, controller.signal, true),
    } as const satisfies Record<
      (typeof OPENQUEST_WEBMCP_TOOLS)[number]["name"],
      WebMCP.ToolExecuteCallback
    >;

    const tools: WebMCP.ModelContextTool[] = OPENQUEST_WEBMCP_TOOLS.map((tool) => ({
      annotations: tool.annotations,
      description: tool.description,
      execute: executeByName[tool.name],
      inputSchema: tool.inputSchema,
      name: tool.name,
      title: tool.title,
    }));

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
