import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/telegram/miniAppAuth";
import { isOwner } from "@/lib/owner";
import { getGroupSettings, listAllGroupIds } from "@/lib/db/groups";
import { estimateLatencyPercentile, getShadowStatsByChatId } from "@/lib/db/shadowStats";

export const runtime = "nodejs";

// §2 / §11.4 release gate: the new scorer's p95 latency must stay under this
// before MODERATION_V2 can flip shadow→on.
const LATENCY_BUDGET_MS = 250;

export async function GET(req: Request) {
  const user = authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isOwner(user.id)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const daysParam = Number(new URL(req.url).searchParams.get("days"));
  const days = daysParam === 14 || daysParam === 30 ? daysParam : 7;

  const chatIds = await listAllGroupIds();
  const { overall, perGroup } = await getShadowStatsByChatId(chatIds, days);

  // Only groups with at least one comparable decision — this card is about
  // divergence, and a group whose whole window was non-comparable has no
  // agree/stricter/looser split to show (it still counts in "groups covered"
  // on the bot-wide card).
  const withDivergence = perGroup.filter(
    (g) => g.stats.divergence.agree + g.stats.divergence.stricter + g.stats.divergence.looser > 0
  );

  // Titles only for those groups, not all registered ones — keeps this
  // fan-out to withDivergence.length.
  const titles = await Promise.all(withDivergence.map((g) => getGroupSettings(g.chatId)));

  // Sorted by absolute divergence (stricter + looser) desc so the groups that
  // most need a look float up; the client still renders each row's own rate,
  // since a large group at 2% outranks a small one at 40% by count alone.
  const perGroupRows = withDivergence
    .map((g, i) => ({
      chatId: g.chatId,
      title: titles[i]?.title ?? `Chat ${g.chatId}`,
      total: g.stats.total,
      comparable: g.stats.comparable,
      divergence: g.stats.divergence,
      zone: g.stats.zone,
    }))
    .sort((a, b) => b.divergence.stricter + b.divergence.looser - (a.divergence.stricter + a.divergence.looser));

  // estimateLatencyPercentile returns the bucket's upper bound, or null when
  // the percentile falls in the open-ended ">=250ms" bucket — which for p95
  // means over the §11.4 budget. `hasData` disambiguates that null from the
  // "nothing scored yet" null. The `<= budgetMs` check is only meaningful
  // because the histogram's top finite bound (250) equals the budget today;
  // it stays correct if a coarser bound is ever added above it.
  const p95Ms = estimateLatencyPercentile(overall.latencyBuckets, 0.95);

  return NextResponse.json({
    days,
    groupCount: chatIds.length,
    stats: overall,
    perGroup: perGroupRows,
    latency: {
      p50Ms: estimateLatencyPercentile(overall.latencyBuckets, 0.5),
      p95Ms,
      meanMs: overall.total === 0 ? null : overall.latencySumMs / overall.total,
      budgetMs: LATENCY_BUDGET_MS,
      p95WithinBudget: overall.total > 0 && p95Ms !== null && p95Ms <= LATENCY_BUDGET_MS,
    },
    hasData: overall.total > 0,
  });
}
