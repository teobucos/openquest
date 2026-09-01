import { z } from "zod";

export const LIVE_INVALIDATION_TYPE = "openquest.changed";
export const NETWORK_LIVE_HUB = "network";

const CanonicalQuestIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);

const LiveInvalidationSchema = z.strictObject({
  sequence: z.number().int().nonnegative(),
  type: z.literal(LIVE_INVALIDATION_TYPE),
});

export type LiveInvalidation = z.output<typeof LiveInvalidationSchema>;

export function liveHubName(questId?: string): string {
  return questId ? `quest:${questId}` : NETWORK_LIVE_HUB;
}

export function parseLiveInvalidation(value: string): LiveInvalidation | null {
  try {
    const parsed = LiveInvalidationSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function serializeLiveInvalidation(sequence: number): string {
  return JSON.stringify({ sequence, type: LIVE_INVALIDATION_TYPE } satisfies LiveInvalidation);
}

export function parseLiveQuestId(url: URL): string | null | undefined {
  const keys = [...url.searchParams.keys()];
  if (keys.length === 0) return undefined;
  if (keys.length !== 1 || keys[0] !== "quest_id") return null;
  const questIds = url.searchParams.getAll("quest_id");
  if (questIds.length !== 1) return null;
  const parsed = CanonicalQuestIdSchema.safeParse(questIds[0]);
  return parsed.success ? parsed.data : null;
}
