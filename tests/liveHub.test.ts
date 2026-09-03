import { describe, expect, it } from "bun:test";
import { resolveAllowedLiveOrigins, validateLiveSocketRequest } from "../src/liveScope";

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

  it("accepts a configured public Origin behind a local HTTPS terminator", async () => {
    const request = new Request("http://127.0.0.1:4173/api/live", {
      headers: {
        origin: "https://openquest.tailnet.example:8449",
        upgrade: "websocket",
      },
    });
    const result = await validateLiveSocketRequest(
      request,
      async () => true,
      "https://openquest.tailnet.example:8449",
    );

    expect(result).toEqual({ questId: undefined });
  });

  it("accepts any origin from a multi-origin allowlist and rejects the rest", async () => {
    const allowed = [
      "https://openquest.acronew.dev",
      "https://openquest.tailnet.example:8449",
    ];
    const first = await validateLiveSocketRequest(
      liveRequest("/api/live", "https://openquest.acronew.dev"),
      async () => true,
      allowed,
    );
    const second = await validateLiveSocketRequest(
      liveRequest("/api/live", "https://openquest.tailnet.example:8449"),
      async () => true,
      allowed,
    );
    const rejected = await validateLiveSocketRequest(
      liveRequest("/api/live", "https://evil.example"),
      async () => true,
      allowed,
    );

    expect(first).toEqual({ questId: undefined });
    expect(second).toEqual({ questId: undefined });
    if (!(rejected instanceof Response)) throw new Error("Expected an origin rejection response.");
    expect(rejected.status).toBe(403);
  });
});

describe("resolveAllowedLiveOrigins", () => {
  it("prefers the plural allowlist over the legacy singular origin", () => {
    expect(
      resolveAllowedLiveOrigins({
        OPENQUEST_PUBLIC_ORIGIN: "https://legacy.example",
        OPENQUEST_PUBLIC_ORIGINS: "https://openquest.acronew.dev, https://openquest.tailnet.example:8449",
      }),
    ).toEqual(["https://openquest.acronew.dev", "https://openquest.tailnet.example:8449"]);
  });

  it("falls back to the legacy singular origin when the plural list is unset", () => {
    expect(
      resolveAllowedLiveOrigins({ OPENQUEST_PUBLIC_ORIGIN: "https://legacy.example" }),
    ).toEqual(["https://legacy.example"]);
  });

  it("falls back to the legacy singular origin when the plural list is blank", () => {
    expect(
      resolveAllowedLiveOrigins({
        OPENQUEST_PUBLIC_ORIGIN: "https://legacy.example",
        OPENQUEST_PUBLIC_ORIGINS: "   ",
      }),
    ).toEqual(["https://legacy.example"]);
  });

  it("returns undefined when neither variable is set so callers use same-origin", () => {
    expect(resolveAllowedLiveOrigins({})).toBeUndefined();
  });

  it("trims entries and drops empties", () => {
    expect(
      resolveAllowedLiveOrigins({ OPENQUEST_PUBLIC_ORIGINS: " https://a.example ,, https://b.example " }),
    ).toEqual(["https://a.example", "https://b.example"]);
  });
});
