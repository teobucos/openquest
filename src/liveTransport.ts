import { liveHubName, serializeLiveInvalidation } from "./liveProtocol";

export interface LiveHubStub {
  fetch(input: string, init: RequestInit): Promise<Response>;
}

export interface LiveHubNamespace<Id> {
  get(id: Id): LiveHubStub;
  idFromName(name: string): Id;
}

export interface LiveTransportLogger {
  error(message: string, details?: unknown): void;
}

export type LiveInvalidationPublisher = (
  questId: string,
  latestSequence: number,
) => Promise<void>;

interface CommittedMutationNotification {
  latestEventSequence(questId: string): Promise<number>;
  publish: LiveInvalidationPublisher;
  resolveQuestId(): Promise<string | null>;
}

async function notifyHub<Id>(
  namespace: LiveHubNamespace<Id>,
  name: string,
  latestSequence: number,
): Promise<void> {
  const hub = namespace.get(namespace.idFromName(name));
  const response = await hub.fetch("https://openquest-live-hub.invalid/broadcast", {
    body: serializeLiveInvalidation(latestSequence),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Live hub ${name} rejected invalidation with HTTP ${response.status}.`);
  }
}

export async function broadcastLiveInvalidation<Id>(
  namespace: LiveHubNamespace<Id>,
  questId: string,
  latestSequence: number,
  logger: LiveTransportLogger = console,
): Promise<void> {
  const names = [liveHubName(), liveHubName(questId)];
  const outcomes = await Promise.allSettled(
    names.map((name) => notifyHub(namespace, name, latestSequence)),
  );
  for (const [index, outcome] of outcomes.entries()) {
    if (outcome.status === "rejected") {
      logger.error("OpenQuest live transport notification failed", {
        hub: names[index],
        reason: outcome.reason,
      });
    }
  }
}

export async function notifyCommittedMutation(
  notification: CommittedMutationNotification,
  logger: LiveTransportLogger = console,
): Promise<void> {
  try {
    const questId = await notification.resolveQuestId();
    if (!questId) {
      logger.error("OpenQuest live transport could not resolve the affected Quest.");
      return;
    }
    const latestSequence = await notification.latestEventSequence(questId);
    await notification.publish(questId, latestSequence);
  } catch (cause) {
    logger.error("OpenQuest live transport publish failed", cause);
  }
}
