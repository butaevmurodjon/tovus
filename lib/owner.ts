const DEFAULT_OWNER_ID = 431725701;

/** The bot owner's numeric Telegram id — `BOT_OWNER_ID` env var, or the
 * hardcoded default. Exported (not just isOwner's boolean) for callers that
 * need to actually address a message TO the owner, e.g. relaying a support
 * ticket (lib/telegram/support.ts). */
export function ownerId(): number {
  const envOwnerId = Number(process.env.BOT_OWNER_ID);
  return Number.isFinite(envOwnerId) && envOwnerId > 0 ? envOwnerId : DEFAULT_OWNER_ID;
}

export function isOwner(userId: number): boolean {
  return userId === ownerId();
}
