import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { ZodType } from "zod";
import {
  ApiErrorResponseSchema,
  CreateChallengeResponseSchema,
  CreateQuestResponseSchema,
  GetNextWorkResponseSchema,
  ObserveQuestsResponseSchema,
  ReviewContributionResponseSchema,
  SubmitContributionResponseSchema,
  type GetNextWorkInput,
  type ObserveQuestsInput,
  type ProposeInput,
  type ReviewContributionInput,
  type SubmitContributionInput,
} from "../src/contracts";

type OptionalFields<Type, Fields extends keyof Type> = Omit<Type, Fields> & Partial<Pick<Type, Fields>>;

interface ToolInputs {
  readonly openquest_observe: OptionalFields<ObserveQuestsInput, "limit">;
  readonly openquest_next: OptionalFields<GetNextWorkInput, "mode">;
  readonly openquest_submit: OptionalFields<SubmitContributionInput, "evidence">;
  readonly openquest_review: OptionalFields<ReviewContributionInput, "evidence">;
  readonly openquest_propose: ProposeInput;
}

type ToolInvocation = {
  [Name in keyof ToolInputs]: {
    readonly name: Name;
    readonly input: ToolInputs[Name];
  };
}[keyof ToolInputs];

interface WebMcpCall {
  readonly isError: boolean;
  readonly text: string;
}

declare global {
  interface Window {
    __openquestWebMcp: {
      invoke(name: ToolInvocation["name"], input: ToolInvocation["input"]): Promise<WebMcpCall>;
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
    window.__openquestWebMcp = {
      names: () => Array.from(tools.keys()).sort(),
      invoke: async (name, input) => {
        const tool = tools.get(name);
        if (!tool) throw new Error("WebMCP tool is not registered: " + name);
        const result = await tool.execute(input);
        const text = result.content && result.content[0] ? result.content[0].text : "{}";
        return { isError: Boolean(result.isError), text };
      },
    };
  })();
`;

async function installFakeWebMcp(context: BrowserContext): Promise<void> {
  await context.addInitScript(fakeWebMcpRuntime);
}

async function callTool(page: Page, invocation: ToolInvocation): Promise<WebMcpCall> {
  return page.evaluate<WebMcpCall, ToolInvocation>((request) => {
    return window.__openquestWebMcp.invoke(request.name, request.input);
  }, invocation);
}

async function successfulTool<Result>(
  page: Page,
  invocation: ToolInvocation,
  schema: ZodType<Result>,
): Promise<Result> {
  const call = await callTool(page, invocation);
  expect(call.isError, call.text).toBe(false);
  return schema.parse(JSON.parse(call.text));
}

async function failedTool(page: Page, invocation: ToolInvocation) {
  const call = await callTool(page, invocation);
  expect(call.isError).toBe(true);
  return ApiErrorResponseSchema.parse(JSON.parse(call.text));
}

async function registeredToolNames(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => window.__openquestWebMcp.names());
}

function rootBackground(page: Page): Promise<string> {
  return page.locator("html").evaluate((root) => getComputedStyle(root).backgroundColor);
}

function challengeRow(page: Page, title: string) {
  return page.locator("article.challenge-row").filter({
    has: page.getByRole("heading", { name: title, exact: true }),
  });
}

test("theme follows the system and persists an explicit override", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "dark" });
  const page = await context.newPage();
  await page.goto("/");

  const root = page.locator("html");
  const theme = page.getByLabel("Color theme");
  await expect(theme).toHaveValue("system");
  await expect(root).not.toHaveAttribute("data-theme");
  const systemDark = await rootBackground(page);

  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => rootBackground(page)).not.toBe(systemDark);
  const systemLight = await rootBackground(page);

  await theme.selectOption("dark");
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect.poll(() => rootBackground(page)).toBe(systemDark);
  await page.reload();
  await expect(page.getByLabel("Color theme")).toHaveValue("dark");

  await page.getByLabel("Color theme").selectOption("light");
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect.poll(() => rootBackground(page)).toBe(systemLight);
  await page.reload();
  await expect(page.getByLabel("Color theme")).toHaveValue("light");

  await page.getByLabel("Color theme").selectOption("system");
  await expect(root).not.toHaveAttribute("data-theme");
  await context.close();
});

test("OpenQuest coordinates the complete public two-session workflow", async ({
  browser,
  request,
}, testInfo) => {
  const publicRead = await request.get("/api/world");
  expect(publicRead.status()).toBe(200);
  expect(publicRead.headers()["set-cookie"]).toBeUndefined();

  const readOnlySelection = await request.post("/api/work/next", { data: {} });
  expect(readOnlySelection.status()).toBe(200);
  expect(readOnlySelection.headers()["set-cookie"]).toBeUndefined();

  const secureWrite = await request.post("/api/quests", {
    data: {
      title: `Secure cookie Quest ${crypto.randomUUID()}`,
      goal: "Verify that HTTPS mutations issue the required anonymous session cookie.",
      description: "A public E2E security check.",
    },
    headers: {
      "cf-connecting-ip": `e2e-secure-${crypto.randomUUID()}`,
      "x-forwarded-proto": "https",
    },
  });
  expect(secureWrite.status()).toBe(201);
  const issuedCookie = secureWrite.headers()["set-cookie"] ?? "";
  expect(issuedCookie).toContain("oq_session=");
  expect(issuedCookie).toContain("HttpOnly");
  expect(issuedCookie).toContain("SameSite=Lax");
  expect(issuedCookie).toContain("Secure");

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

  const toolNames = [
    "openquest_next",
    "openquest_observe",
    "openquest_propose",
    "openquest_review",
    "openquest_submit",
  ];
  await expect(registeredToolNames(pageA)).resolves.toEqual(toolNames);
  await expect(registeredToolNames(pageB)).resolves.toEqual(toolNames);
  await expect(pageA.getByText("5 Site Tools ready", { exact: true })).toBeVisible();

  const questTitle = `OpenQuest E2E ${testInfo.workerIndex} ${crypto.randomUUID()}`;
  await pageA.getByLabel("Title", { exact: true }).fill(questTitle);
  await pageA.getByLabel("Goal", { exact: true }).fill(
    "Prove that humans set direction while independent sessions move public work forward.",
  );
  await pageA.getByLabel("Description", { exact: true }).fill(
    "Everything in this test Quest is deliberately public and non-confidential.",
  );
  await pageA.getByRole("button", { name: "Create Quest", exact: true }).click();
  await expect(pageA).toHaveURL(/\/q\/[a-z0-9-]+$/);
  await expect(pageA.getByRole("heading", { name: questTitle, exact: true })).toBeVisible();
  await expect(pageA.getByTestId("activity-list")).toContainText(`New Quest: ${questTitle}`);

  const observed = await successfulTool(
    pageA,
    { name: "openquest_observe", input: {} },
    ObserveQuestsResponseSchema,
  );
  const quest = observed.quests.find((candidate) => candidate.title === questTitle);
  expect(quest).toBeDefined();
  if (!quest) throw new Error("Human-created Quest was absent from public observation.");

  await pageB.goto(`/q/${quest.slug}`);
  await expect(pageB.getByRole("heading", { name: questTitle, exact: true })).toBeVisible();

  const firstChallengeTitle = `Cross-session Challenge ${crypto.randomUUID()}`;
  const firstChallenge = await successfulTool(
    pageA,
    {
      name: "openquest_propose",
      input: {
        kind: "challenge",
        quest_id: quest.id,
        title: firstChallengeTitle,
        description: "Produce a bounded public result that a different browser session can independently check.",
      },
    },
    CreateChallengeResponseSchema,
  );
  expect(firstChallenge.challenge_status).toBe("open");
  await expect(challengeRow(pageA, firstChallengeTitle)).toHaveAttribute("data-status", "open");
  await expect(challengeRow(pageB, firstChallengeTitle)).toBeVisible({ timeout: 10_000 });
  await expect(pageA.getByTestId("activity-list")).toContainText(`New Challenge: ${firstChallengeTitle}`);

  const explicitWork = await successfulTool(
    pageA,
    {
      name: "openquest_next",
      input: { quest_id: quest.id, mode: "contribute" },
    },
    GetNextWorkResponseSchema,
  );
  expect(explicitWork.status).toBe("work_available");
  if (explicitWork.status !== "work_available") throw new Error("Expected Contribution work.");
  expect(explicitWork.work_type).toBe("contribute");
  expect(explicitWork.challenge.id).toBe(firstChallenge.challenge_id);
  expect(explicitWork.quest.id).toBe(quest.id);

  const contributionContent = "Verified public result.\n\nThe preserved whitespace is intentional.";
  const submitted = await successfulTool(
    pageA,
    {
      name: "openquest_submit",
      input: {
        challenge_id: firstChallenge.challenge_id,
        summary: "A bounded result ready for independent Review.",
        content: contributionContent,
        evidence: [{ url: "https://example.com/public-evidence", title: "Public evidence" }],
      },
    },
    SubmitContributionResponseSchema,
  );
  expect(submitted.challenge_status).toBe("awaiting_review");
  await expect(challengeRow(pageA, firstChallengeTitle)).toHaveAttribute("data-status", "awaiting_review");
  await expect(challengeRow(pageB, firstChallengeTitle)).toHaveAttribute(
    "data-status",
    "awaiting_review",
    { timeout: 10_000 },
  );

  const selfReview = await failedTool(pageA, {
    name: "openquest_review",
    input: {
      contribution_id: submitted.contribution_id,
      verdict: "support",
      reason: "This must be rejected because this session submitted the work.",
    },
  });
  expect(selfReview.status).toBe("self_review_forbidden");
  expect(selfReview.next_action?.tool).toBe("openquest_next");

  const automaticReview = await successfulTool(
    pageB,
    { name: "openquest_next", input: { quest_id: quest.id } },
    GetNextWorkResponseSchema,
  );
  expect(automaticReview.status).toBe("work_available");
  if (automaticReview.status !== "work_available") throw new Error("Expected Review work.");
  expect(automaticReview.work_type).toBe("review");
  if (automaticReview.work_type !== "review") throw new Error("Default routing did not prefer Review.");
  expect(automaticReview.contribution.id).toBe(submitted.contribution_id);

  const supported = await successfulTool(
    pageB,
    {
      name: "openquest_review",
      input: {
        contribution_id: submitted.contribution_id,
        verdict: "support",
        reason: "A separate browser session independently confirmed the public result.",
      },
    },
    ReviewContributionResponseSchema,
  );
  expect(supported.challenge_status).toBe("resolved");
  await expect(challengeRow(pageA, firstChallengeTitle)).toHaveAttribute(
    "data-status",
    "resolved",
    { timeout: 10_000 },
  );
  await expect(challengeRow(pageB, firstChallengeTitle)).toHaveAttribute("data-status", "resolved");
  await expect(pageA.getByTestId("activity-list")).toContainText(`Resolved: ${firstChallengeTitle}`);

  const secondChallengeTitle = `Challenge verdict path ${crypto.randomUUID()}`;
  const secondChallenge = await successfulTool(
    pageA,
    {
      name: "openquest_propose",
      input: {
        kind: "challenge",
        quest_id: quest.id,
        title: secondChallengeTitle,
        description: "Exercise the append-first challenging Review path and preserve the prior work publicly.",
      },
    },
    CreateChallengeResponseSchema,
  );
  const challengedContribution = await successfulTool(
    pageA,
    {
      name: "openquest_submit",
      input: {
        challenge_id: secondChallenge.challenge_id,
        summary: "A deliberately incomplete public result.",
        content: "This result needs stronger supporting evidence.",
      },
    },
    SubmitContributionResponseSchema,
  );
  const challenged = await successfulTool(
    pageB,
    {
      name: "openquest_review",
      input: {
        contribution_id: challengedContribution.contribution_id,
        verdict: "challenge",
        reason: "The conclusion is not yet supported by evidence.",
      },
    },
    ReviewContributionResponseSchema,
  );
  expect(challenged.challenge_status).toBe("open");
  await expect(challengeRow(pageA, secondChallengeTitle)).toHaveAttribute(
    "data-status",
    "open",
    { timeout: 10_000 },
  );
  await expect(pageA.getByTestId("activity-list")).toContainText(`Reopened: ${secondChallengeTitle}`);

  const historyPage = await sessionA.newPage();
  await historyPage.goto(`/contributions/${challengedContribution.contribution_id}`);
  await expect(historyPage.getByText("A deliberately incomplete public result.", { exact: true })).toBeVisible();
  await expect(historyPage.getByText("challenged", { exact: true })).toBeVisible();
  await expect(historyPage.getByText("The conclusion is not yet supported by evidence.", { exact: true })).toBeVisible();

  const agentQuestTitle = `Agent-created Quest ${crypto.randomUUID()}`;
  const agentQuest = await successfulTool(
    pageB,
    {
      name: "openquest_propose",
      input: {
        kind: "quest",
        title: agentQuestTitle,
        goal: "Publish a new open problem directly through the agent participation layer.",
        description: "This Quest should become public immediately without approval.",
      },
    },
    CreateQuestResponseSchema,
  );
  expect(agentQuest.quest_status).toBe("active");
  await pageB.goto("/");
  await expect(pageB.getByRole("heading", { name: agentQuestTitle, exact: true })).toBeVisible({ timeout: 10_000 });

  const invalidWorkerResponse = await pageB.request.post("/api/contributions", {
    data: {
      challenge_id: secondChallenge.challenge_id,
      summary: "Direct HTTP validation",
      content: "x".repeat(12_001),
    },
  });
  expect(invalidWorkerResponse.status()).toBe(400);
  expect(await invalidWorkerResponse.json()).toMatchObject({ status: "invalid_input" });

  const scriptTitle = `<script>alert(1)</script> ${crypto.randomUUID()}`;
  await successfulTool(
    pageA,
    {
      name: "openquest_propose",
      input: {
        kind: "challenge",
        quest_id: quest.id,
        title: scriptTitle,
        description: "Render this adversarial-looking public title as inert text without executing it.",
      },
    },
    CreateChallengeResponseSchema,
  );
  await expect(challengeRow(pageA, scriptTitle)).toBeVisible({ timeout: 10_000 });
  await expect(pageA.locator("article.challenge-row script")).toHaveCount(0);

  for (const url of ["javascript:alert(1)", "data:text/plain,unsafe", "file:///tmp/unsafe"]) {
    const unsafeEvidence = await failedTool(pageA, {
      name: "openquest_submit",
      input: {
        challenge_id: secondChallenge.challenge_id,
        summary: "Unsafe evidence must be rejected.",
        content: "This mutation must never reach shared state.",
        evidence: [{ url, title: "Unsafe URL" }],
      },
    });
    expect(unsafeEvidence.status).toBe("invalid_input");
  }

  const unscoped = await successfulTool(
    pageB,
    { name: "openquest_next", input: { mode: "contribute" } },
    GetNextWorkResponseSchema,
  );
  expect(unscoped.status).toBe("work_available");
  const scoped = await successfulTool(
    pageB,
    { name: "openquest_next", input: { quest_id: quest.id, mode: "contribute" } },
    GetNextWorkResponseSchema,
  );
  expect(scoped.status).toBe("work_available");
  if (scoped.status !== "work_available") throw new Error("Expected scoped work.");
  expect(scoped.quest.id).toBe(quest.id);

  const finalObservation = await successfulTool(
    pageA,
    { name: "openquest_observe", input: { quest_id: quest.id } },
    ObserveQuestsResponseSchema,
  );
  expect(finalObservation.active_agents).toBeGreaterThanOrEqual(2);
  expect(finalObservation.challenges?.some((candidate) => candidate.id === firstChallenge.challenge_id)).toBe(true);

  await historyPage.close();
  await sessionA.close();
  await sessionB.close();
});
