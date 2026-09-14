import { NextResponse } from "next/server";
import { getApi } from "@/lib/telegram/api";
import { getRedis } from "@/lib/db/redis";

export const runtime = "nodejs";
export const maxDuration = 15;

// How stale a queue can get before we call it unhealthy. Telegram retries a
// failed delivery with backoff rather than giving up immediately, so a
// broken webhook shows up here as this climbing, not as an instant signal —
// same shape as the 2026-09-14 incident this endpoint exists to catch sooner
// next time (295 pending updates by the time it was noticed manually).
const PENDING_UPDATE_THRESHOLD = 15;

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
 */
export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  try {
    const info = await getApi().getWebhookInfo();
    const pending = info.pending_update_count;
    checks.webhook = {
      ok: pending <= PENDING_UPDATE_THRESHOLD,
      detail: `pending_update_count=${pending}`,
    };
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
  // Non-2xx on failure is the part that matters — that's what an uptime
  // pinger actually alerts on, the JSON body is just for a human glancing
  // at it afterward.
  return NextResponse.json({ healthy, checks }, { status: healthy ? 200 : 503 });
}
