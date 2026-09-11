/**
 * Rough "is this a freshly-created Telegram account" heuristic.
 *
 * The Bot API never exposes an account's creation date. What it does expose
 * is the numeric user ID, which Telegram assigns roughly sequentially over
 * time — so an ID can be mapped to an *approximate* creation date by
 * interpolating between publicly-known (id, approximate-date) reference
 * points (community-tracked, not an official API guarantee). Precision is
 * ±weeks at best, degrades further the older/less-documented the ID range,
 * and a determined spammer can buy an aged account — so, same tier as
 * profileSignals.ts/impersonation.ts: this is a weak, correlational signal.
 * It is never a basis for punishment by itself; the only caller (bot.ts)
 * uses it to decide whether the extra `getChat` bio-fetch + scam-text check
 * is worth doing at all, gating an already-soft signal (bad bio/name only
 * forces captcha) to the case it's actually meant for — a spam account spun
 * up minutes before joining, not an old account with a crude nickname.
 */
const ID_DATE_POINTS: readonly (readonly [id: number, isoDate: string])[] = [
  [1_000_000, "2013-08-01"],
  [10_000_000, "2014-06-01"],
  [100_000_000, "2016-01-01"],
  [300_000_000, "2017-01-01"],
  [700_000_000, "2018-06-01"],
  [1_000_000_000, "2019-01-01"],
  [1_500_000_000, "2020-06-01"],
  [2_000_000_000, "2021-06-01"],
  [3_000_000_000, "2022-06-01"],
  [5_000_000_000, "2023-06-01"],
  [6_500_000_000, "2024-06-01"],
  [7_500_000_000, "2025-06-01"],
];

const POINTS: readonly (readonly [id: number, time: number])[] = ID_DATE_POINTS.map(
  ([id, iso]) => [id, new Date(iso).getTime()] as const
);

/** Approximate account-creation date for a Telegram user ID. Clamped to "now" at the top end. */
export function estimateAccountCreatedAt(userId: number): Date {
  const id = Math.abs(userId);
  const now = Date.now();

  if (id <= POINTS[0][0]) return new Date(POINTS[0][1]);

  for (let i = 1; i < POINTS.length; i++) {
    const [prevId, prevTime] = POINTS[i - 1];
    const [curId, curTime] = POINTS[i];
    if (id <= curId) {
      const ratio = (id - prevId) / (curId - prevId);
      return new Date(Math.min(now, prevTime + ratio * (curTime - prevTime)));
    }
  }

  // Beyond the last known reference point: extrapolate using the slope of
  // the last segment (new accounts keep being minted past whatever this
  // table's last data point is).
  const [prevId, prevTime] = POINTS[POINTS.length - 2];
  const [lastId, lastTime] = POINTS[POINTS.length - 1];
  const rate = (lastTime - prevTime) / (lastId - prevId);
  return new Date(Math.min(now, lastTime + rate * (id - lastId)));
}

const DEFAULT_MAX_AGE_DAYS = 30;

/** True if the account's estimated age is under `maxAgeDays` (default 30). */
export function isLikelyNewAccount(userId: number, maxAgeDays = DEFAULT_MAX_AGE_DAYS): boolean {
  const ageMs = Date.now() - estimateAccountCreatedAt(userId).getTime();
  return ageMs < maxAgeDays * 24 * 60 * 60 * 1000;
}
