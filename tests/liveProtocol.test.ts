import { describe, expect, it } from "bun:test";
import {
  LIVE_INVALIDATION_TYPE,
  liveHubName,
  parseLiveInvalidation,
  parseLiveQuestId,
  serializeLiveInvalidation,
} from "../src/liveProtocol";

describe("OpenQuest live transport protocol", () => {
  it("keeps messages compact, closed, and sequence-only", () => {
    const message = parseLiveInvalidation(serializeLiveInvalidation(42));
    expect(message).toEqual({ sequence: 42, type: LIVE_INVALIDATION_TYPE });
    expect(parseLiveInvalidation('{"type":"openquest.changed","sequence":42,"content":"private"}'))
      .toBeNull();
    expect(parseLiveInvalidation('{"type":"openquest.changed","sequence":-1}')).toBeNull();
    expect(parseLiveInvalidation("not json")).toBeNull();
  });

  it("maps only network and canonical Quest scopes to hubs", () => {
    expect(liveHubName()).toBe("network");
    expect(liveHubName("quest_1")).toBe("quest:quest_1");
    expect(parseLiveQuestId(new URL("https://openquest.test/api/live"))).toBeUndefined();
    expect(parseLiveQuestId(new URL("https://openquest.test/api/live?quest_id=quest_1")))
      .toBe("quest_1");
    expect(parseLiveQuestId(new URL("https://openquest.test/api/live?quest_id=quest_1&status=open")))
      .toBeNull();
    expect(parseLiveQuestId(new URL("https://openquest.test/api/live?quest_id=not%20an%20id")))
      .toBeNull();
  });
});
