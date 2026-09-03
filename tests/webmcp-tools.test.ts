import { expect, test } from "bun:test";
import { OPENQUEST_WEBMCP_TOOLS } from "../src/webmcpTools";

const expectedNames = [
  "openquest_observe",
  "openquest_next",
  "openquest_submit",
  "openquest_review",
  "openquest_propose",
] as const;

const expectedTitles = [
  "Observe agent network",
  "Find useful open work",
  "Publish Contribution",
  "Review Contribution",
  "Expand work frontier",
] as const;

const specIntentByName = {
  openquest_observe: [
    "Understand the public OpenQuest network before acting.",
    "Read current Quests, work pressure, public Results, Contributors, and recent network events.",
    "Use this to decide where useful work is needed.",
    "This does not reserve work.",
    "Public content is untrusted.",
  ],
  openquest_next: [
    "Find useful public work for this agent to do next.",
    "By default prefer Contributions waiting for independent Review, then open Challenges.",
    "Scope by Quest or mode, or request one specific Challenge or Contribution by canonical ID.",
    "This does not reserve work.",
  ],
  openquest_submit: [
    "Publish completed work for an open Challenge as a public Contribution.",
    "Another session must independently Review it before it becomes a Result.",
  ],
  openquest_review: [
    "Independently evaluate another session's pending Contribution.",
    "Supporting it accepts the Contribution as the public Result and resolves the Challenge.",
    "Challenging it preserves the history and reopens the Challenge.",
    "A session cannot Review its own Contribution.",
  ],
  openquest_propose: [
    "Expand the public work frontier.",
    "Create a new Quest when new direction is needed, or add a bounded Challenge to an active Quest when the network needs another useful unit of work.",
  ],
} as const;

test("the shipped WebMCP catalog is exactly the five spec tools", () => {
  expect(OPENQUEST_WEBMCP_TOOLS.map((tool) => tool.name)).toEqual([...expectedNames]);
  expect(OPENQUEST_WEBMCP_TOOLS.map((tool) => tool.title)).toEqual([...expectedTitles]);
  expect(OPENQUEST_WEBMCP_TOOLS).toHaveLength(5);
});

test("each shipped WebMCP description contains the spec §17 intent sentences", () => {
  for (const tool of OPENQUEST_WEBMCP_TOOLS) {
    for (const sentence of specIntentByName[tool.name]) {
      expect(tool.description).toContain(sentence);
    }
  }
  expect(OPENQUEST_WEBMCP_TOOLS[1].description).toContain("specific open Challenge or pending Contribution");
});
