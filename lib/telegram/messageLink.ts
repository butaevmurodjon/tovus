/**
 * Parses a t.me message link into what's needed to act on it — never fetches
 * anything. Two link shapes:
 *  - Public:  t.me/<username>/<messageId>            (also .../<threadId>/<messageId> for forum topics)
 *  - Private: t.me/c/<internalId>/<messageId>         (same optional thread segment)
 * `internalId` is the supergroup's numeric id with the "-100" prefix stripped
 * (Telegram's own convention for these links) — chatId is reconstructed as
 * `-100<internalId>`.
 */
export interface ParsedMessageLink {
  kind: "public" | "private";
  /** Username (no "@") for public links, or the already-resolved numeric chatId for private ones. */
  chatRef: string | number;
  messageId: number;
}

export function parseMessageLink(raw: string): ParsedMessageLink | null {
  const trimmed = raw.trim();
  if (!/^(https?:\/\/)?t\.me\//i.test(trimmed)) return null;

  let pathname: string;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    pathname = url.pathname;
  } catch {
    return null;
  }

  const segments = pathname.split("/").filter(Boolean);
  if (segments.length < 2) return null;

  // Last numeric segment is always the message id, whether or not a forum
  // thread id sits between the chat reference and it.
  const messageId = Number(segments[segments.length - 1]);
  if (!Number.isInteger(messageId) || messageId <= 0) return null;

  if (segments[0] === "c") {
    if (segments.length < 3) return null;
    const internalId = Number(segments[1]);
    if (!Number.isInteger(internalId) || internalId <= 0) return null;
    return { kind: "private", chatRef: Number(`-100${internalId}`), messageId };
  }

  const username = segments[0];
  if (!/^[a-z0-9_]{5,}$/i.test(username)) return null;
  return { kind: "public", chatRef: username, messageId };
}
