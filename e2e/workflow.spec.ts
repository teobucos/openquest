import { expect, test, type BrowserContext, type Page } from "@playwright/test";

type WorkMode = "any" | "contribute" | "review";
type ReviewVerdict = "support" | "challenge" | "needs_work";

interface Mission {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
}

interface Need {
  readonly id: string;
  readonly title: string;
}

interface WorkItem {
  readonly work_type: "contribute" | "review";
  readonly mission: Mission;
  readonly need: Need;
  readonly contribution_id?: string;
}

interface ToolResult {
  readonly status?: string;
  readonly missions?: readonly Mission[];
  readonly mission?: Mission;
  readonly work_type?: WorkItem["work_type"];
  readonly need?: Need;
  readonly contribution?: { readonly id: string };
  readonly contribution_id?: string;
  readonly need_status?: "open" | "awaiting_review" | "resolved";
  readonly need_id?: string;
}

interface ToolInvocation {
  readonly name:
    | "observe_missions"
    | "get_next_work"
    | "submit_contribution"
    | "review_contribution"
    | "propose_need";
  readonly input: {
    readonly mission_id?: string;
    readonly mode?: WorkMode;
    readonly need_id?: string;
    readonly summary?: string;
    readonly result?: {
      readonly answer: string;
    };
    readonly contribution_id?: string;
    readonly verdict?: ReviewVerdict;
    readonly reason?: string;
    readonly title?: string;
    readonly instructions?: string;
    readonly rationale?: string;
  };
}

declare global {
  interface Window {
    __openshareWebMcp: {
      invoke(name: ToolInvocation["name"], input: ToolInvocation["input"]): Promise<ToolResult>;
      names(): string[];
    };
  }
}

const fakeWebMcpRuntime = `
  (() => {
    const tools = new Map();
    const modelContext = {
      registerTool(tool, options) {
        tools.set(tool.name, tool);
        if (options && options.signal) {
          options.signal.addEventListener("abort", () => tools.delete(tool.name), { once: true });
        }
        return Promise.resolve();
      },
    };
    Object.defineProperty(document, "modelContext", { configurable: true, value: modelContext });
    window.__openshareWebMcp = {
      names: () => Array.from(tools.keys()).sort(),
      invoke: async (name, input) => {
        const tool = tools.get(name);
        if (!tool) {
          return Promise.reject(new Error("WebMCP tool is not registered: " + name));
        }
        const result = await tool.execute(input);
        const text = result.content && result.content[0] ? result.content[0].text : "{}";
        if (result.isError) {
          throw new Error(text);
        }
        return JSON.parse(text);
      },
    };
  })();
`;

async function installFakeWebMcp(context: BrowserContext): Promise<void> {
  await context.addInitScript(fakeWebMcpRuntime);
}

async function invokeTool(page: Page, invocation: ToolInvocation): Promise<ToolResult> {
  return page.evaluate<ToolResult, ToolInvocation>((request) => {
    return window.__openshareWebMcp.invoke(request.name, request.input);
  }, invocation);
}

async function registeredToolNames(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    return window.__openshareWebMcp.names();
  });
}

function missionFrom(result: ToolResult): Mission {
  const mission = result.mission ?? result.missions?.[0];
  if (!mission) {
    throw new Error("observe_missions returned no mission");
  }
  return mission;
}

function workFrom(result: ToolResult, expectedKind: WorkItem["work_type"]): WorkItem {
  if (!result.mission || !result.need || result.work_type !== expectedKind) {
    throw new Error(`get_next_work did not return ${expectedKind} work`);
  }
  return {
    work_type: result.work_type,
    mission: result.mission,
    need: result.need,
    contribution_id: result.contribution?.id,
  };
}

function needColumn(page: Page, title: "Needs help" | "Needs review" | "Resolved") {
  return page
    .locator("section.need-column")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}

test("two WebMCP sessions contribute, cross-review, resolve, and refresh the mission UI", async ({
  browser,
}, testInfo) => {
  const sessionA = await browser.newContext({
    extraHTTPHeaders: { "cf-connecting-ip": `e2e-session-a-${crypto.randomUUID()}` },
  });
  const sessionB = await browser.newContext({
    extraHTTPHeaders: { "cf-connecting-ip": `e2e-session-b-${crypto.randomUUID()}` },
  });
  await installFakeWebMcp(sessionA);
  await installFakeWebMcp(sessionB);

  const pageA = await sessionA.newPage();
  const pageB = await sessionB.newPage();
  await pageA.goto("/");
  await pageB.goto("/");

  await expect(pageA.getByText("Needs help", { exact: true })).toBeVisible();
  await expect(pageA.getByText("Needs review", { exact: true })).toBeVisible();
  await expect(pageA.getByText("Resolved", { exact: true })).toBeVisible();
  await expect(registeredToolNames(pageA)).resolves.toEqual([
    "get_next_work",
    "observe_missions",
    "propose_need",
    "review_contribution",
    "submit_contribution",
  ]);

  const observed = await invokeTool(pageA, {
    name: "observe_missions",
    input: {},
  });
  const mission = missionFrom(observed);
  await pageA.goto(`/m/${mission.slug}`);
  await pageB.goto(`/m/${mission.slug}`);

  const testNeedTitle = `E2E cross-session need ${testInfo.workerIndex}-${crypto.randomUUID()}`;
  const proposed = await invokeTool(pageA, {
    name: "propose_need",
    input: {
      mission_id: mission.id,
      title: testNeedTitle,
      instructions: "Verify one bounded WebMCP behavior with primary-source evidence.",
      rationale: "Each E2E run appends a distinct Need instead of rewriting shared history.",
    },
  });
  expect(proposed.status).toBe("proposed");
  expect(proposed.need_status).toBe("open");
  expect(proposed.need_id).toBeTruthy();

  const availableWork = workFrom(
    await invokeTool(pageA, {
      name: "get_next_work",
      input: { mission_id: mission.id, mode: "contribute" },
    }),
    "contribute",
  );
  expect(availableWork.mission.id).toBe(mission.id);
  expect(availableWork.need.id).toBeTruthy();

  const submitted = await invokeTool(pageA, {
    name: "submit_contribution",
    input: {
      need_id: proposed.need_id ?? "",
      summary: "Verified the current WebMCP limitation from the official documentation.",
      result: {
        answer: "ChatGPT-compatible tools must be registered imperatively at the top-level page.",
      },
    },
  });
  expect(submitted.status).toBe("submitted");
  expect(submitted.need_status).toBe("awaiting_review");
  expect(submitted.contribution_id).toBeTruthy();

  const reviewingNeedA = needColumn(pageA, "Needs review").getByRole("heading", {
    name: testNeedTitle,
    exact: true,
  });
  const reviewingNeedB = needColumn(pageB, "Needs review").getByRole("heading", {
    name: testNeedTitle,
    exact: true,
  });
  await expect(reviewingNeedA).toBeVisible();
  await expect(reviewingNeedB).toBeVisible({ timeout: 10_000 });

  await expect(
    invokeTool(pageA, {
      name: "review_contribution",
      input: {
        contribution_id: submitted.contribution_id ?? "",
        verdict: "support",
        reason: "This must fail because session A submitted the contribution.",
      },
    }),
  ).rejects.toThrow(/self|own|different session/i);

  const availableReview = workFrom(
    await invokeTool(pageB, {
      name: "get_next_work",
      input: { mission_id: mission.id, mode: "review" },
    }),
    "review",
  );
  expect(availableReview.contribution_id).toBeTruthy();

  const reviewed = await invokeTool(pageB, {
    name: "review_contribution",
    input: {
      contribution_id: submitted.contribution_id ?? "",
      verdict: "support",
      reason: "A separate browser session independently confirmed the cited limitation.",
    },
  });
  expect(reviewed.status).toBe("review_recorded");
  expect(reviewed.need_status).toBe("resolved");

  await expect(reviewingNeedA).not.toBeVisible({ timeout: 10_000 });
  await expect(
    needColumn(pageA, "Resolved").getByRole("heading", {
      name: testNeedTitle,
      exact: true,
    }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    needColumn(pageB, "Resolved").getByRole("heading", {
      name: testNeedTitle,
      exact: true,
    }),
  ).toBeVisible();

  await expect(
    invokeTool(pageA, {
      name: "submit_contribution",
      input: {
        need_id: proposed.need_id ?? "",
        summary: "A resolved Need must not accept a second contribution.",
        result: { answer: "This mutation is expected to be rejected." },
      },
    }),
  ).rejects.toThrow(/no longer open|unavailable/i);

  await expect(
    invokeTool(pageB, {
      name: "review_contribution",
      input: {
        contribution_id: submitted.contribution_id ?? "",
        verdict: "support",
        reason: "The same contribution must not accept another terminal review.",
      },
    }),
  ).rejects.toThrow(/no longer awaiting|already reviewed|conflict/i);

  await expect(
    invokeTool(pageB, {
      name: "propose_need",
      input: {
        mission_id: mission.id,
        title: "x".repeat(161),
        instructions: "This bounded-schema test must fail before reaching the Worker.",
        rationale: "Oversize agent input cannot bypass the WebMCP contract.",
      },
    }),
  ).rejects.toThrow(/160|too big|maximum/i);

  const reopenTitle = `E2E needs-work branch ${testInfo.workerIndex}-${crypto.randomUUID()}`;
  const reopenNeed = await invokeTool(pageA, {
    name: "propose_need",
    input: {
      mission_id: mission.id,
      title: reopenTitle,
      instructions: "Verify that a needs-work review reopens the shared Need.",
      rationale: "The non-support branch must remain usable and visible to contributors.",
    },
  });
  const reopenContribution = await invokeTool(pageA, {
    name: "submit_contribution",
    input: {
      need_id: reopenNeed.need_id ?? "",
      summary: "A deliberately incomplete contribution for transition coverage.",
      result: { answer: "This result still needs a primary source." },
    },
  });
  const reopened = await invokeTool(pageB, {
    name: "review_contribution",
    input: {
      contribution_id: reopenContribution.contribution_id ?? "",
      verdict: "needs_work",
      reason: "The contribution does not yet include the required primary evidence.",
    },
  });
  expect(reopened.need_status).toBe("open");
  await expect(
    needColumn(pageA, "Needs help").getByRole("heading", {
      name: reopenTitle,
      exact: true,
    }),
  ).toBeVisible({ timeout: 10_000 });

  await sessionA.close();
  await sessionB.close();
});
