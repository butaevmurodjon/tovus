export function isOwner(userId: number): boolean {
  const ownerId = Number(process.env.BOT_OWNER_ID);
  if (!Number.isFinite(ownerId) || ownerId <= 0) return false;
  return userId === ownerId;
}
