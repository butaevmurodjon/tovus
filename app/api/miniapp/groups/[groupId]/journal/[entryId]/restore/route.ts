import { NextResponse } from "next/server";
import { authorizeGroupAdmin } from "@/lib/telegram/miniAppAuth";
import { findJournalEntry, markJournalEntryRestored } from "@/lib/db/journal";
import { getGroupSettings } from "@/lib/db/groups";
import { getApi } from "@/lib/telegram/api";
import { t } from "@/lib/i18n";

export const runtime = "nodejs";

function parseChatId(groupId: string): number | null {
  const id = Number(groupId);
  return Number.isFinite(id) ? id : null;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ groupId: string; entryId: string }> }
) {
  const { groupId, entryId } = await params;
  const chatId = parseChatId(groupId);
  if (chatId === null) return NextResponse.json({ error: "invalid group" }, { status: 400 });

  const auth = await authorizeGroupAdmin(req, chatId);
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  const [entry, settings] = await Promise.all([
    findJournalEntry(chatId, entryId),
    getGroupSettings(chatId),
  ]);
  if (!entry || !settings) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (entry.restored) return NextResponse.json({ entry });

  const api = getApi();
  const lang = settings.lang;

  if (entry.action === "mute") {
    await api
      .restrictChatMember(chatId, entry.userId, {
        can_send_messages: true,
        can_send_audios: true,
        can_send_documents: true,
        can_send_photos: true,
        can_send_videos: true,
        can_send_video_notes: true,
        can_send_voice_notes: true,
        can_send_polls: true,
        can_send_other_messages: true,
        can_add_web_page_previews: true,
      })
      .catch(() => {});
  } else if (entry.action === "ban") {
    await api.unbanChatMember(chatId, entry.userId, { only_if_banned: true }).catch(() => {});
  }

  if (entry.text) {
    await api
      .sendMessage(chatId, `${t(lang, "bot.restoredNotice")}\n\n${entry.displayName}: ${entry.text}`)
      .catch(() => {});
  }

  const updated = await markJournalEntryRestored(chatId, entryId);
  return NextResponse.json({ entry: updated });
}
