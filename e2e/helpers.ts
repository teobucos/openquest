import { expect, type BrowserContext, type Page } from "@playwright/test";
import type { ZodType } from "zod";
import type {
  CreateChallengeResponse,
  CreateQuestResponse,
  GetNextWorkInput,
  GetNextWorkResponse,
  ObserveInput,
  ObserveResponse,
  ProposeInput,
  ReviewContributionResponse,
  ReviewContributionInput,
  SubmitContributionResponse,
  SubmitContributionInput,
} from "../src/contracts";

interface ToolInputs {
  readonly openquest_next: GetNextWorkInput;
  readonly openquest_observe: ObserveInput;
  readonly openquest_propose: ProposeInput;
  readonly openquest_review: ReviewContributionInput;
  readonly openquest_submit: SubmitContributionInput;
}

export type ToolInvocation = {
  [Name in keyof ToolInputs]: {
    readonly input: ToolInputs[Name];
    readonly name: Name;
  };
}[keyof ToolInputs];

type WebMcpToolValue =
  | CreateChallengeResponse
  | CreateQuestResponse
  | GetNextWorkResponse
  | ObserveResponse
  | ReviewContributionResponse
  | SubmitContributionResponse;

export type WebMcpCall =
  | {
      readonly ok: true;
      readonly value: WebMcpToolValue;
    }
  | {
      readonly error: string;
      readonly ok: false;
    };

export interface RegisteredTool {
  readonly description: string;
  readonly inputSchema: WebMCP.ModelContextTool["inputSchema"];
  readonly name: ToolInvocation["name"];
  readonly title: string | undefined;
}

interface InvocationOptions {
  readonly abort?: boolean;
}

declare global {
  interface Window {
    __openquestWebMcp: {
      abortRegistrations(): void;
      invoke(
        name: ToolInvocation["name"],
        input: ToolInvocation["input"],
        options?: InvocationOptions,
      ): Promise<WebMcpCall>;
      tools(): RegisteredTool[];
    };
  }
}

const fakeWebMcpRuntime = `
  (() => {
    const tools = new Map();
    const registrationControllers = [];
    const modelContext = {
      registerTool(tool, options) {
        tools.set(tool.name, tool);
        if (options && options.signal) {
          registrationControllers.push(options.signal);
          options.signal.addEventListener("abort", () => tools.delete(tool.name), { once: true });
        }
        return Promise.resolve();
      },
    };
    Object.defineProperty(document, "modelContext", { configurable: true, value: modelContext });
    window.__openquestWebMcp = {
      abortRegistrations() {
        for (const signal of registrationControllers) {
          signal.dispatchEvent(new Event("abort"));
        }
      },
      tools: () => Array.from(tools.values())
        .map((tool) => ({
          description: tool.description,
          inputSchema: tool.inputSchema,
          name: tool.name,
          title: tool.title,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      invoke: async (name, input, options) => {
        const tool = tools.get(name);
        if (!tool) throw new Error("WebMCP tool is not registered: " + name);
        const controller = new AbortController();
        if (options && options.abort) controller.abort();
        try {
          const value = await tool.execute(input, { signal: controller.signal });
          return { ok: true, value };
        } catch (cause) {
          return {
            error: cause instanceof Error ? cause.message : "OpenQuest tool execution failed.",
            ok: false,
          };
        }
      },
    };
  })();
`;

export async function installFakeWebMcp(context: BrowserContext): Promise<void> {
  await context.addInitScript(fakeWebMcpRuntime);
}

export async function callTool(page: Page, invocation: ToolInvocation): Promise<WebMcpCall> {
  return page.evaluate<WebMcpCall, ToolInvocation>((request) => {
    return window.__openquestWebMcp.invoke(request.name, request.input);
  }, invocation);
}

export async function cancelledTool(page: Page, invocation: ToolInvocation): Promise<WebMcpCall> {
  return page.evaluate<WebMcpCall, ToolInvocation>((request) => {
    return window.__openquestWebMcp.invoke(request.name, request.input, { abort: true });
  }, invocation);
}

export async function successfulTool<Result>(
  page: Page,
  invocation: ToolInvocation,
  schema: ZodType<Result>,
): Promise<Result> {
  const call = await callTool(page, invocation);
  expect(call).toMatchObject({ ok: true });
  if (!call.ok) throw new Error(call.error);
  return schema.parse(call.value);
}

export async function failedTool(page: Page, invocation: ToolInvocation): Promise<string> {
  const call = await callTool(page, invocation);
  expect(call).toMatchObject({ ok: false });
  if (call.ok) throw new Error("Expected WebMCP tool execution to reject.");
  return call.error;
}

export async function registeredTools(page: Page): Promise<RegisteredTool[]> {
  return page.evaluate(() => window.__openquestWebMcp.tools());
}

export async function abortRegisteredTools(page: Page): Promise<void> {
  await page.evaluate(() => window.__openquestWebMcp.abortRegistrations());
}

export function challengeRow(page: Page, title: string) {
  return page.locator("article.challenge-row").filter({
    has: page.getByRole("heading", { exact: true, name: title }),
  });
}
