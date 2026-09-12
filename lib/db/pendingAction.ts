import { getRedis } from "./redis";

/**
 * Generalized version of the "waiting for a private-chat reply" pattern that
 * appeals.ts pioneered (setPendingAppeal/getPendingAppeal/clearPendingAppeal)
 * — appeals.ts is left as-is (it already shipped and works), but every NEW
 * flow that needs "user opened the bot via a deep link, their next private
 * message means something specific" should use this instead of inventing its
 * own Redis key + TTL, so two features can't collide on the same user's
 * pending state.
 *
 * One user can only have ONE pending action of ANY kind at a time — setting a
 * new one overwrites whatever was pending before (same "switched flows
 * mid-way" semantics appeals.ts already has for its own single kind).
 */
export type PendingActionKind = "captcha" | "support";

export interface PendingAction<K extends PendingActionKind = PendingActionKind, P = unknown> {
  kind: K;
  payload: P;
}

const pendingKey = (userId: number) => `pending:${userId}`;

export async function setPendingAction<K extends PendingActionKind, P>(
  userId: number,
  kind: K,
  payload: P,
  ttlSeconds: number
): Promise<void> {
  const value: PendingAction<K, P> = { kind, payload };
  await getRedis().set(pendingKey(userId), value, { ex: ttlSeconds });
}

export async function getPendingAction(userId: number): Promise<PendingAction | null> {
  return (await getRedis().get<PendingAction>(pendingKey(userId))) ?? null;
}

/** Only clears if it's still the SAME pending action a caller just consumed —
 * a plain `del` would also wipe out a different, newer pending action that
 * arrived (via another deep link) between that caller's read and this clear. */
export async function clearPendingActionIfKind(userId: number, kind: PendingActionKind): Promise<void> {
  const redis = getRedis();
  const current = await redis.get<PendingAction>(pendingKey(userId));
  if (current?.kind === kind) await redis.del(pendingKey(userId)).catch(() => {});
}
