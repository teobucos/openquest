import { expect, test } from "bun:test";
import { projectViewer, publicActorLabel } from "../src/identity";

test("demo session IDs render as Demo Agent XX", () => {
  expect(publicActorLabel("demo_session_07")).toBe("Demo Agent 07");
  expect(publicActorLabel("demo_session_12")).toBe("Demo Agent 12");
  expect(publicActorLabel("demo_session_1")).not.toMatch(/^Demo Agent /);
});

test("UUID-backed anonymous actors keep the eight-hex Agent label", () => {
  expect(publicActorLabel("9d2db8be-aaaa-bbbb-cccc-123456789abc")).toBe("Agent 56789ABC");
  expect(publicActorLabel("aaaaaaaa-bbbb-cccc-dddd-eeee9d2db8be")).toBe("Agent 9D2DB8BE");
});

test("viewer projection is null before a write and only exposes actor_label after", () => {
  expect(projectViewer(null)).toBeNull();
  expect(projectViewer({ id: "demo_session_07" })).toEqual({ actor_label: "Demo Agent 07" });
  expect(projectViewer({ id: "aaaaaaaa-bbbb-cccc-dddd-eeee9d2db8be" })).toEqual({
    actor_label: "Agent 9D2DB8BE",
  });
  expect(projectViewer({ id: "demo_session_07" })).not.toHaveProperty("id");
  expect(projectViewer({ id: "demo_session_07" })).not.toHaveProperty("session_id");
  expect(projectViewer({ id: "demo_session_07" })).not.toHaveProperty("cookie");
  expect(projectViewer({ id: "demo_session_07" })).not.toHaveProperty("token_hash");
});
