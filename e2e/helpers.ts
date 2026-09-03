import { expect, type BrowserContext, type Page } from "@playwright/test";
import type { ZodType } from "zod";
import { ApiErrorResponseSchema } from "../src/contracts";
import type {
  ApiErrorResponse,
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
  | ApiErrorResponse
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
  readonly annotations: WebMCP.ToolAnnotations | undefined;
  readonly description: string;
  readonly inputSchema: WebMCP.ModelContextTool["inputSchema"];
  readonly name: ToolInvocation["name"];
  readonly title: string | undefined;
}

interface InvocationOptions {
  readonly abort?: boolean;
}

type WebMcpToolInput = Parameters<WebMCP.ToolExecuteCallback>[0];

declare global {
  interface Window {
    __openquestWebMcp: {
      changeNotifications(): number;
      invoke(
        name: string,
        input: WebMcpToolInput,
        options?: InvocationOptions,
      ): Promise<WebMcpCall>;
      tools(): RegisteredTool[];
    };
  }
}

const fakeWebMcpRuntime = `
  (() => {
    let changeNotifications = 0;
    const tools = new Map();
    const modelContext = {
      async registerTool(tool, options) {
        if (tools.has(tool.name)) {
          throw new DOMException("A tool with this name is already registered.", "InvalidStateError");
        }
        if (tool.name.length === 0) {
          throw new TypeError("Tool name must not be empty.");
        }
        if (tool.description.length === 0) {
          throw new TypeError("Tool description must not be empty.");
        }
        if (tool.name.length > 128) {
          throw new TypeError("Tool name must not exceed 128 characters.");
        }
        if (!/^[A-Za-z0-9_.-]+$/.test(tool.name)) {
          throw new TypeError("Tool name contains an unsupported character.");
        }
        JSON.stringify(tool.inputSchema);
        if (options && options.signal && options.signal.aborted) throw options.signal.reason;
        tools.set(tool.name, tool);
        if (options && options.signal) {
          options.signal.addEventListener("abort", () => {
            if (tools.get(tool.name) === tool) tools.delete(tool.name);
          }, { once: true });
        }
      },
    };
    Object.defineProperty(document, "modelContext", { configurable: true, value: modelContext });
    window.addEventListener("openquest:changed", () => {
      changeNotifications += 1;
    });
    window.__openquestWebMcp = {
      changeNotifications: () => changeNotifications,
      tools: () => Array.from(tools.values())
        .map((tool) => ({
          annotations: tool.annotations,
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
          const serialized = JSON.stringify(value);
          if (serialized === undefined) {
            throw new TypeError("Tool result is not JSON serializable.");
          }
          return { ok: true, value: JSON.parse(serialized) };
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

export async function domainErrorTool(
  page: Page,
  invocation: ToolInvocation,
  status?: ApiErrorResponse["status"],
): Promise<ApiErrorResponse> {
  const call = await callTool(page, invocation);
  expect(call).toMatchObject({ ok: true });
  if (!call.ok) throw new Error(call.error);
  const error = ApiErrorResponseSchema.parse(call.value);
  if (status) expect(error.status).toBe(status);
  return error;
}

export async function cancelledTool(page: Page, invocation: ToolInvocation): Promise<string> {
  const call = await page.evaluate<WebMcpCall, ToolInvocation>((request) => {
    return window.__openquestWebMcp.invoke(request.name, request.input, { abort: true });
  }, invocation);
  expect(call).toMatchObject({ ok: false });
  if (call.ok) throw new Error("Expected cancelled WebMCP execution to reject.");
  return call.error;
}

export async function registeredTools(page: Page): Promise<RegisteredTool[]> {
  return page.evaluate(() => window.__openquestWebMcp.tools());
}

export async function mutationNotifications(page: Page): Promise<number> {
  return page.evaluate(() => window.__openquestWebMcp.changeNotifications());
}

export function challengeRow(page: Page, title: string) {
  return page.locator(".work-row").filter({ hasText: title });
}

export async function expandRailSection(page: Page, title: string): Promise<void> {
  const section = page.locator("aside.command-rail details").filter({
    has: page.getByRole("heading", { name: title, exact: true }),
  });
  await expect(section).toBeVisible();
  const opened = await section.evaluate((node) => node instanceof HTMLDetailsElement && node.open);
  if (!opened) await section.locator(":scope > summary").click();
  await expect(section).toHaveJSProperty("open", true);
}
