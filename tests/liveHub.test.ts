import { describe, expect, it } from "bun:test";
import { validateLiveSocketRequest } from "../src/liveScope";

function liveRequest(path: string, origin?: string): Request {
  const headers = new Headers({ upgrade: "websocket" });
  if (origin) headers.set("origin", origin);
  return new Request(`https://openquest.test${path}`, { headers });
}

describe("OpenQuest live socket scope validation", () => {
  it("does not allocate a Quest hub before D1 confirms the Quest exists", async () => {
    let checkedQuestId: string | undefined;
    const result = await validateLiveSocketRequest(
      liveRequest("/api/live?quest_id=quest_missing"),
      async (questId) => {
        checkedQuestId = questId;
        return false;
      },
    );

    expect(checkedQuestId).toBe("quest_missing");
    if (!(result instanceof Response)) throw new Error("Expected a missing Quest response.");
    expect(result.status).toBe(404);
  });

  it("requires a matching browser Origin but permits non-browser test upgrades", async () => {
    const hasQuest = async () => true;
    const mismatched = await validateLiveSocketRequest(
      liveRequest("/api/live", "https://other.example"),
      hasQuest,
    );
    const absent = await validateLiveSocketRequest(liveRequest("/api/live"), hasQuest);

    if (!(mismatched instanceof Response)) throw new Error("Expected an origin rejection response.");
    expect(mismatched.status).toBe(403);
    expect(absent).toEqual({ questId: undefined });
  });

  it("accepts a canonical existing Quest scope after validation", async () => {
    const result = await validateLiveSocketRequest(
      liveRequest("/api/live?quest_id=quest_present", "https://openquest.test"),
      async (questId) => questId === "quest_present",
    );

    expect(result).toEqual({ questId: "quest_present" });
  });
});
