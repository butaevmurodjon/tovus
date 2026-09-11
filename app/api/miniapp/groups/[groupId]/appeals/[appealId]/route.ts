import { NextResponse, after } from "next/server";
import { authorizeGroupAdmin } from "@/lib/telegram/miniAppAuth";
import { findAppeal, setAppealOffer, setAppealStatus } from "@/lib/db/appeals";
import { getGroupSettings } from "@/lib/db/groups";
import { getApi } from "@/lib/telegram/api";
import { t } from "@/lib/i18n";
import { MAX_UNBAN_PRICE_STARS, MIN_UNBAN_PRICE_STARS, sendUnbanInvoice } from "@/lib/telegram/payments";
import { recordAdminLabel } from "@/lib/moderation/corpusCollector";

export const runtime = "nodejs";

function parseChatId(groupId: string): number | null {
  const id = Number(groupId);
  return Number.isFinite(id) ? id : null;
}

/**
 * The Mini App's three actions on an appeal card: "Разбанить" (free unban,
 * mark resolved), "Отклонить" (mark dismissed, no Telegram API call), or
 * "Предложить платный разбан" (send a Stars invoice priced by this admin —
 * see payments.ts). Same `authorizeGroupAdmin` any group admin can use —
 * unlike the owner-only `/api/miniapp/owner/.../unban` route, this isn't tied
 * to owner-level access, since responding to a member's own appeal is
 * ordinary group moderation, not platform administration.
 *
 * The paid-unban money itself is NOT this: Telegram Stars invoices always
 * settle to the BOT's own account, never to a specific admin (see payments.ts'
 * comment above createUnbanInvoiceLink) — this route never claims otherwise,
 * and the Mini App copy that offers this action must say so before an admin
 * sets a price.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ groupId: string; appealId: string }> }
) {
  const { groupId, appealId } = await params;
  const chatId = parseChatId(groupId);
  if (chatId === null) return NextResponse.json({ error: "invalid group" }, { status: 400 });

  const auth = await authorizeGroupAdmin(req, chatId);
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  const body = (await req.json().catch(() => ({}))) as { action?: string; amountStars?: number };
  if (body.action !== "unban" && body.action !== "dismiss" && body.action !== "offer_paid_unban") {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }

  let amountStars: number | null = null;
  if (body.action === "offer_paid_unban") {
    amountStars = Math.round(Number(body.amountStars));
    if (
      !Number.isFinite(amountStars) ||
      amountStars < MIN_UNBAN_PRICE_STARS ||
      amountStars > MAX_UNBAN_PRICE_STARS
    ) {
      return NextResponse.json({ error: "invalid_amount" }, { status: 400 });
    }
  }

  const [entry, settings] = await Promise.all([findAppeal(chatId, appealId), getGroupSettings(chatId)]);
  if (!entry || !settings) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Fully closed appeals never accept another action — without this, a
  // second browser tab (or a retried request) on an already-"resolved"/
  // "dismissed" card could re-open it, e.g. silently overwriting whatever the
  // successful_payment handler in bot.ts just wrote (see appeals.ts).
  if (entry.status === "resolved" || entry.status === "dismissed") {
    return NextResponse.json({ error: "already_closed", entry }, { status: 409 });
  }
  // "payment_failed" means the appellant already paid but unbanChatMember
  // itself failed — retrying the (free) unban, or giving up and dismissing,
  // are both fine; sending a SECOND Stars invoice for a case that was already
  // paid once is not.
  if (entry.status === "payment_failed" && body.action === "offer_paid_unban") {
    return NextResponse.json({ error: "already_paid", entry }, { status: 409 });
  }

  const api = getApi();

  if (body.action === "unban") {
    // Checked explicitly, not best-effort: if the bot lost ban rights in this
    // group, the admin must see that the action failed (and can retry / fix
    // permissions), not a false "resolved" while the member stays banned.
    const unbanned = await api.unbanChatMember(chatId, entry.userId, { only_if_banned: true }).catch(() => false);
    if (!unbanned) return NextResponse.json({ error: "unban_failed" }, { status: 502 });
    await api
      .sendMessage(entry.userId, t(settings.lang, "bot.appealResolvedUnban", { title: settings.title }))
      .catch(() => {});
    const updated = await setAppealStatus(chatId, appealId, "resolved");

    // An admin approving an appeal is a real gold false-positive signal ("the
    // ban itself was wrong") — same treatment as journal.ts's restore path,
    // just weaker evidence: only the appellant's own appeal text is on hand
    // here, not the original offending message (AppealEntry never links back
    // to it), so detVerdict/detSource stay null and this uses its own
    // goldSource ("admin_appeal_unban", see corpus.ts) rather than
    // "admin_restore". messageId: 0 — there's no real Telegram message this
    // sample corresponds to, only the appeal text itself; recordAdminLabel
    // dedups on text hash, not messageId, so this doesn't collide with real
    // messages. Best-effort, never blocks the response; hard no-op unless
    // CORPUS_ENABLED.
    after(() =>
      recordAdminLabel({
        chatId,
        messageId: 0,
        userId: entry.userId,
        username: entry.username,
        displayName: entry.displayName,
        text: entry.text,
        detVerdict: null,
        detSource: null,
        goldLabel: "none",
        goldSource: "admin_appeal_unban",
        goldBy: auth.user.id,
      }).catch(() => {})
    );

    return NextResponse.json({ entry: updated });
  }

  if (body.action === "offer_paid_unban" && amountStars !== null) {
    // If the appellant blocked the bot (or deleted the chat) since appealing,
    // sendMessage throws — the appeal must stay exactly as it was, not flip
    // to "offer_sent" for an invoice nobody actually received.
    try {
      await sendUnbanInvoice(api, chatId, entry.userId, appealId, amountStars, settings.title, settings.lang);
    } catch {
      return NextResponse.json({ error: "delivery_failed" }, { status: 502 });
    }
    const updated = await setAppealOffer(chatId, appealId, amountStars);
    return NextResponse.json({ entry: updated });
  }

  const updated = await setAppealStatus(chatId, appealId, "dismissed");
  return NextResponse.json({ entry: updated });
}
