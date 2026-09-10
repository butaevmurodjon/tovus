import type { Api } from "grammy";
import { countReferrals, isRewarded, markRewarded, unmarkRewarded } from "@/lib/db/referrals";
import { getGroupSettings } from "@/lib/db/groups";
import { isProActive } from "@/lib/billing/plan";
import { DEFAULT_LANG, t } from "@/lib/i18n";
import { getUserLang } from "@/lib/db/userLang";
import { activateProPlan } from "./payments";

// ---------------------------------------------------------------------------
// Owner-tunable reward terms (GROWTH.md §2.4 / §5.5). Changing any of these
// changes the offer, nothing else — no storage migration, no other file.
// ---------------------------------------------------------------------------

/** Confirmed distinct groups an inviter must bring in before the reward pays out. */
export const REFERRAL_GROUPS_FOR_REWARD = 3;

/** Months of Pro granted when the threshold is crossed. Paid out once per
 * inviter, ever (the claim in lib/db/referrals.ts `markRewarded` caps it). */
export const REFERRAL_REWARD_MONTHS = 1;

/** A group only counts toward the threshold if it has at least this many
 * members — the cheap anti-farming gate. An unknown member count never counts
 * (see `isCreditableReferral`). */
export const REFERRAL_MIN_MEMBERS = 10;

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Pays out the referral reward if the inviter just earned it.
 *
 * Payout target is the group that crossed the threshold (`chatId`), passed in
 * by the caller — an inviter doesn't own a "balance", they get one specific
 * group upgraded. `markRewarded` is claimed BEFORE the grant (SET NX) so two
 * concurrent crossings can't both pay, and released again if the grant fails,
 * so a transient error doesn't burn the reward for nothing.
 *
 * Never throws: this runs off the my_chat_member path, where nothing about
 * registering a group may depend on a reward succeeding.
 */
export async function maybeRewardReferrer(api: Api, inviterId: number, chatId: number): Promise<boolean> {
  try {
    const count = await countReferrals(inviterId);
    if (count < REFERRAL_GROUPS_FOR_REWARD) return false;
    if (await isRewarded(inviterId)) return false;
    if (!(await markRewarded(inviterId))) return false;

    // activateProPlan overwrites planExpiresAt rather than extending it, so
    // compute the base here: a group already on paid Pro must gain a month,
    // never have its remaining time truncated to one month from today.
    const settings = await getGroupSettings(chatId).catch(() => null);
    const base = settings && isProActive(settings) && settings.planExpiresAt ? settings.planExpiresAt : Date.now();
    const expiresAt = base + REFERRAL_REWARD_MONTHS * MONTH_MS;

    const granted = await activateProPlan(chatId, expiresAt).catch(() => false);
    if (!granted) {
      // The group vanished (or the write failed) — give the claim back rather
      // than leaving the inviter permanently "rewarded" with nothing.
      await unmarkRewarded(inviterId);
      return false;
    }

    // The inviter's own stored language (set when they open the Mini App), not
    // the rewarded group's — the DM goes to them, and the group's `lang` was
    // derived from whoever ADDED the bot, i.e. the invitee.
    const lang = (await getUserLang(inviterId).catch(() => null)) ?? DEFAULT_LANG;
    await api
      .sendMessage(
        inviterId,
        // The real confirmed count, not the threshold — they may have crossed
        // it with more than the minimum in the same window.
        t(lang, "bot.refRewarded", {
          count,
          months: REFERRAL_REWARD_MONTHS,
          title: settings?.title || String(chatId),
        })
      )
      // The inviter may have blocked the bot or never opened a private chat —
      // the grant already landed, so a failed DM must not undo it.
      .catch(() => {});

    return true;
  } catch {
    return false;
  }
}
