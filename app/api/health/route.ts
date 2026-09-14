import { NextResponse } from "next/server";
import { getApi } from "@/lib/telegram/api";
import { getRedis } from "@/lib/db/redis";
import { SITE_URL } from "@/lib/seo";

export const runtime = "nodejs";
export const maxDuration = 15;

// How stale a queue can get before we call it unhealthy. Telegram retries a
// failed delivery with backoff rather than giving up immediately, so a
// broken webhook shows up here as this climbing, not as an instant signal —
// same shape as the 2026-09-14 incident this endpoint exists to catch sooner
// next time (295 pending updates by the time it was noticed manually).
const PENDING_UPDATE_THRESHOLD = 15;

// Must match scripts/set-webhook.mjs's list exactly — Telegram's setWebhook
// treats an OMITTED allowed_updates as "reset to receiving everything", not
// "leave whatever was registered before" (verified against the Bot API
// docs), so a self-heal call missing "message_reaction" here would silently
// re-narrow/widen what the bot receives on every unhealthy poll.
const ALLOWED_UPDATES = [
  "message",
  "edited_message",
  "my_chat_member",
  "chat_member",
  "callback_query",
  "pre_checkout_query",
  "message_reaction",
] as const;

/**
 * Unauthenticated, read-only status check — meant to be polled every few
 * minutes by a free external uptime pinger (UptimeRobot, cron-job.org, …):
 * Vercel Hobby's cron can't run more often than once a day, so an in-house
 * Vercel Cron can't cover this. Checks the two things that silently took the
 * bot fully offline on 2026-09-14 with no visible error in any group:
 *   1. Telegram webhook health (getWebhookInfo) — a large pending_update_count
 *      means Telegram can't deliver to us (wrong secret, 500s, wrong URL, …).
 *   2. Redis reachability — every moderation/settings read depends on it.
 * Deliberately reports no secrets/tokens in the response body — this is
 * public by design so any pinger can hit it with no auth.
 *
 * Also self-heals the webhook-auth-desync failure mode (see the selfHeal
 * block below) — the OTHER failure mode from that incident, a genuine
 * application bug making the webhook handler itself throw, has no automatic
 * fix here or anywhere: that always needs a real code fix + deploy.
 */
export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  const selfHeal: { attempted: boolean; ok?: boolean; detail?: string } = { attempted: false };

  try {
    const info = await getApi().getWebhookInfo();
    const pending = info.pending_update_count;
    const webhookOk = pending <= PENDING_UPDATE_THRESHOLD;
    checks.webhook = { ok: webhookOk, detail: `pending_update_count=${pending}` };

    // Re-assert the webhook registration using values already trusted and
    // present in this running deployment's own env — not new/generated, not
    // read from the request, so this is safe to do unauthenticated and
    // idempotent when nothing's actually wrong. Fixes exactly the
    // 2026-09-14 incident's first stage automatically going forward: the
    // registered secret_token silently drifting from TELEGRAM_WEBHOOK_SECRET
    // (someone re-ran scripts/set-webhook.mjs without it sourced, an env
    // rotation that didn't also re-register, …). Does NOT fix — and cannot
    // fix — a genuine application bug making our own handler throw/500;
    // that always still needs a real code fix + deploy, same as before.
    if (!webhookOk) {
      const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
      selfHeal.attempted = true;
      try {
        await getApi().setWebhook(`${SITE_URL}/api/telegram/webhook`, {
          secret_token: secret || undefined,
          allowed_updates: [...ALLOWED_UPDATES],
          drop_pending_updates: false,
        });
        selfHeal.ok = true;
      } catch (err) {
        selfHeal.ok = false;
        selfHeal.detail = err instanceof Error ? err.message : "setWebhook failed";
      }
    }
  } catch (err) {
    checks.webhook = { ok: false, detail: err instanceof Error ? err.message : "getWebhookInfo failed" };
  }

  try {
    await getRedis().ping();
    checks.redis = { ok: true };
  } catch (err) {
    checks.redis = { ok: false, detail: err instanceof Error ? err.message : "redis ping failed" };
  }

  const healthy = Object.values(checks).every((c) => c.ok);
  // Still reports unhealthy THIS round even if selfHeal just fixed the
  // registration — Telegram's existing backlog needs a moment to drain, and
  // "recovered" should come from the next poll actually seeing it clear, not
  // from us asserting it optimistically.
  return NextResponse.json({ healthy, checks, selfHeal }, { status: healthy ? 200 : 503 });
}
