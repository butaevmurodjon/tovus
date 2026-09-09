import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/telegram/miniAppAuth";
import { isOwner } from "@/lib/owner";
import { getGroupSettings, listAllGroupIds } from "@/lib/db/groups";
import {
  countShadowDivergenceSamplesByChatId,
  getShadowDivergenceSamples,
  type DivergenceSample,
} from "@/lib/db/shadowStats";
import { getCachedMessages } from "@/lib/db/messageAuthors";
import { corpusEnabled } from "@/lib/db/corpus";

export const runtime = "nodejs";

// One page of a group's divergence buffer. The buffer holds up to 300/group;
// the screen opens one group at a time and pages through with "show more"
// rather than pulling every group's buffer + text on screen open (ROADMAP §6.5).
const PAGE_SIZE = 15;

interface SampleWithText extends DivergenceSample {
  /** null = the message text is no longer cached — samples live 90d,
   * messageAuthors 30d, and a Redis blip can also drop the write. */
  text: string | null;
}

export async function GET(req: Request) {
  const user = authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isOwner(user.id)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const params = new URL(req.url).searchParams;
  const chatIds = await listAllGroupIds();
  const groupParam = params.get("group");

  // Index mode: per-group title + count, no sample payloads. One pipelined
  // LLEN over every group, then getGroupSettings only for the non-empty ones.
  if (groupParam === null) {
    const nonEmpty = (await countShadowDivergenceSamplesByChatId(chatIds)).filter((g) => g.count > 0);
    const settings = await Promise.all(nonEmpty.map((g) => getGroupSettings(g.chatId)));
    const groups = nonEmpty
      .map((g, i) => ({ chatId: g.chatId, title: settings[i]?.title ?? `Chat ${g.chatId}`, count: g.count }))
      .sort((a, b) => b.count - a.count);
    return NextResponse.json({ corpusEnabled: corpusEnabled(), groups });
  }

  // Page mode: one group's samples with text joined in.
  const chatId = Number(groupParam);
  if (!Number.isInteger(chatId) || !chatIds.includes(chatId)) {
    return NextResponse.json({ error: "invalid group" }, { status: 400 });
  }
  const offset = Math.max(0, Math.trunc(Number(params.get("offset")) || 0));

  const samples = await getShadowDivergenceSamples(chatId, PAGE_SIZE, offset);
  const texts = await getCachedMessages(samples.map((s) => ({ chatId, messageId: s.messageId })));
  const withText: SampleWithText[] = samples.map((s, i) => {
    const cached = texts[i];
    return { ...s, text: cached?.text?.trim() ? cached.text : null };
  });

  return NextResponse.json({ samples: withText, offset, pageSize: PAGE_SIZE });
}
