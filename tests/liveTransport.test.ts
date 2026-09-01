import { describe, expect, it } from "bun:test";
import {
  broadcastLiveInvalidation,
  notifyCommittedMutation,
  queueCommittedMutation,
} from "../src/liveTransport";

interface LoggedError {
  details: unknown;
  message: string;
}

function logger(errors: LoggedError[]) {
  return {
    error(message: string, details?: unknown) {
      errors.push({ details, message });
    },
  };
}

describe("OpenQuest live transport delivery", () => {
  it("notifies network and Quest hubs with the same compact sequence", async () => {
    const requests: Array<{ body: string; name: string; url: string }> = [];
    const errors: LoggedError[] = [];
    const namespace = {
      get(name: string) {
        return {
          async fetch(url: string, init: RequestInit) {
            requests.push({ body: String(init.body), name, url });
            return new Response(null, { status: 204 });
          },
        };
      },
      idFromName(name: string) {
        return name;
      },
    };

    await broadcastLiveInvalidation(namespace, "quest_7", 73, logger(errors));

    expect(requests).toEqual([
      {
        body: '{"latest_sequence":73,"type":"openquest.changed"}',
        name: "network",
        url: "https://openquest-live-hub.invalid/broadcast",
      },
      {
        body: '{"latest_sequence":73,"type":"openquest.changed"}',
        name: "quest:quest_7",
        url: "https://openquest-live-hub.invalid/broadcast",
      },
    ]);
    expect(errors).toEqual([]);
  });

  it("attempts both scopes and only logs a failed best-effort notification", async () => {
    const names: string[] = [];
    const errors: LoggedError[] = [];
    const namespace = {
      get(name: string) {
        return {
          async fetch() {
            names.push(name);
            if (name === "network") throw new Error("offline");
            return new Response(null, { status: 204 });
          },
        };
      },
      idFromName(name: string) {
        return name;
      },
    };

    await broadcastLiveInvalidation(namespace, "quest_8", 74, logger(errors));

    expect(names).toEqual(["network", "quest:quest_8"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe("OpenQuest live transport notification failed");
  });

  it("uses the durable sequence after commit and never propagates publishing failures", async () => {
    const calls: string[] = [];
    const errors: LoggedError[] = [];

    await notifyCommittedMutation({
      async latestEventSequence(questId) {
        calls.push(`sequence:${questId}`);
        return 91;
      },
      async publish(questId, latestSequence) {
        calls.push(`publish:${questId}:${latestSequence}`);
        throw new Error("durable object unavailable");
      },
      async resolveQuestId() {
        calls.push("resolve");
        return "quest_9";
      },
    }, logger(errors));

    expect(calls).toEqual(["resolve", "sequence:quest_9", "publish:quest_9:91"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe("OpenQuest live transport publish failed");
  });

  it("queues a stalled post-commit notification without blocking the write path", () => {
    const queued: Promise<void>[] = [];
    queueCommittedMutation({
      latestEventSequence: () => new Promise<number>(() => {}),
      publish: async () => {},
      resolveQuestId: async () => "quest_stalled",
    }, {
      waitUntil(promise) {
        queued.push(promise);
      },
    });

    expect(queued).toHaveLength(1);
  });
});
