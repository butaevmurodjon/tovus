import { NextResponse } from "next/server";
import { GrammyError } from "grammy";
import { authenticateRequest } from "@/lib/telegram/miniAppAuth";
import { getApi } from "@/lib/telegram/api";
import { isOwner } from "@/lib/owner";
import { parseMessageLink } from "@/lib/telegram/messageLink";
import { getCachedMessage, resolveUsername } from "@/lib/db/messageAuthors";
import { isRegisteredGroup } from "@/lib/db/groups";

export const runtime = "nodejs";

/**
 * Turns whatever the owner pasted into the God Mode "link/username" box into
 * something actionable, without ever needing to fetch the message itself —
 * the Bot API has no "get message by id". A message link resolves to a
 * chatId/messageId pair (real, from the link) plus a best-effort author (only
 * known if the bot saw that message live — see messageAuthors.ts). A
 * @username or numeric id resolves straight to a userId for the global-ban
 * flow.
 */
export async function POST(req: Request) {
  const user = authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isOwner(user.id)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const input = typeof body?.input === "string" ? body.input.trim() : "";
  if (!input) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const api = getApi();
  const link = parseMessageLink(input);
  if (link) {
    let chatId: number;
    if (link.kind === "private") {
      chatId = link.chatRef as number;
    } else {
      try {
        const chat = await api.getChat(`@${link.chatRef}`);
        chatId = chat.id;
      } catch {
        return NextResponse.json({ error: "chat_not_found" }, { status: 404 });
      }
    }
    // Only ever reads cache for chats the bot actually manages — matches the
    // authority of the ban/delete routes this feeds, even though the owner is
    // the only caller here.
    if (!(await isRegisteredGroup(chatId))) {
      return NextResponse.json({ error: "chat_not_found" }, { status: 404 });
    }
    const cached = await getCachedMessage(chatId, link.messageId);
    return NextResponse.json({
      type: "message",
      chatId,
      messageId: link.messageId,
      authorUserId: cached?.userId ?? null,
      text: cached?.text ?? null,
    });
  }

  if (input.startsWith("@")) {
    // Our own index first — getChat on an arbitrary group member with no
    // prior DM to the bot commonly 400s, even though the bot has definitely
    // seen them post. Only falls back to getChat for usernames the bot
    // hasn't cached (e.g. never posted, or cache expired).
    const cachedUserId = await resolveUsername(input);
    if (cachedUserId) {
      return NextResponse.json({ type: "user", userId: cachedUserId, username: input.replace(/^@/, "") });
    }
    try {
      const chat = await api.getChat(input);
      return NextResponse.json({ type: "user", userId: chat.id, username: "username" in chat ? chat.username ?? null : null });
    } catch (err) {
      const status = err instanceof GrammyError ? 404 : 500;
      return NextResponse.json({ error: "user_not_found" }, { status });
    }
  }

  if (/^-?\d+$/.test(input)) {
    return NextResponse.json({ type: "user", userId: Number(input), username: null });
  }

  return NextResponse.json({ error: "invalid_input" }, { status: 400 });
}
