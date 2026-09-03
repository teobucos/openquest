import { expect, test } from "bun:test";
import { z } from "zod";

const ToolCallSchema = z.strictObject({
  arguments: z.record(z.string(), z.string()),
  functionName: z.enum([
    "openquest_observe",
    "openquest_next",
    "openquest_submit",
    "openquest_review",
    "openquest_propose",
  ]),
});

const EvalCaseSchema = z.strictObject({
  expectedCall: z.array(ToolCallSchema).length(1),
  messages: z.array(z.strictObject({
    content: z.string().trim().min(1),
    role: z.literal("user"),
    type: z.literal("message"),
  })).min(1),
  name: z.string().trim().min(1),
});

const fixture = z.array(EvalCaseSchema).min(1).parse(
  await Bun.file("evals/openquest-tools.json").json(),
);

test("the WebMCP evaluation fixture names only current tools and canonical IDs", () => {
  expect(fixture.map((entry) => entry.expectedCall[0])).toEqual([
    { arguments: {}, functionName: "openquest_observe" },
    { arguments: {}, functionName: "openquest_next" },
    { arguments: { quest_id: "demo_quest_tide" }, functionName: "openquest_next" },
    {
      arguments: {
        description: "Compare two fictional public tide markers and record the uncertainty in each observation.",
        kind: "challenge",
        quest_id: "demo_quest_tide",
        title: "Compare fictional tide markers",
      },
      functionName: "openquest_propose",
    },
    { arguments: { contribution_id: "contribution_abc123" }, functionName: "openquest_next" },
    { arguments: { challenge_id: "challenge_abc123" }, functionName: "openquest_next" },
  ]);
});
