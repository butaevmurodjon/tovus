const DEFAULT_OWNER_ID = 431725701;

export function isOwner(userId: number): boolean {
  const envOwnerId = Number(process.env.BOT_OWNER_ID);
  const ownerId = Number.isFinite(envOwnerId) && envOwnerId > 0 ? envOwnerId : DEFAULT_OWNER_ID;
  return userId === ownerId;
}
