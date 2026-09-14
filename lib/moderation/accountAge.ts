/**
 * Rough "is this a freshly-created Telegram account" heuristic.
 *
 * The Bot API never exposes an account's creation date. What it does expose
 * is the numeric user ID, which Telegram assigns roughly sequentially over
 * time — so an ID can be mapped to an *approximate* creation date by
 * interpolating between publicly-known (id, approximate-date) reference
 * points (community-tracked, not an official API guarantee). Precision is
 * ±weeks-to-months at best, degrades further the older/less-documented the
 * ID range, and a determined spammer can buy an aged account — so, same
 * tier as profileSignals.ts/impersonation.ts: this is a weak, correlational
 * signal, never a sole basis for punishment by itself.
 *
 * Two callers, two different risk tolerances for that weak signal:
 * - bot.ts's captcha-force path (`isLikelyNewAccount`, default 30-day
 *   threshold) uses it only to decide whether an already-soft signal (bad
 *   bio/name) is worth the extra `getChat` bio-fetch — gating cost, not
 *   punishing anyone by itself.
 * - The opt-in `minAccountAgeDays` join gate (ROADMAP.md §7.2 item 7 /
 *   §7.3) uses the same estimate to actually kick (ban+unban) a joiner —
 *   an admin who turned that on explicitly accepted the false-positive risk
 *   for a stronger, more specific filter against mass-created spam accounts
 *   (almost always fresh), which is exactly why §7.3 flagged this as the
 *   highest-ROI item in that group.
 *
 * ANCHOR_TABLE is a cleaned subset of the crowd-sourced dataset from
 * https://github.com/Jobians/telegram-id-age (MIT license), pulled
 * 2026-09-14 (upstream data collected 2013-08-14…2025-11-11, 212 raw
 * points) — replaces this file's original hand-picked 12-point table with
 * ~6x the anchor density from an actual maintained dataset. "Cleaned" =
 * sorted by date, then kept only the running maximum id seen so far — the
 * raw data has some out-of-order noise (self-reported dates aren't
 * perfectly precise), and this only needs to be a proper non-decreasing
 * step function of date -> max-id-by-then. The one big jump (2021-10-12 →
 * 2021-12-06, id ~1.97B → ~5.03B) is real, not noise — Telegram widened the
 * user-id space around then, dropping the effective 32-bit ceiling.
 *
 * This table should be refreshed periodically from upstream (or Telegram's
 * actual current rate) rather than trusted indefinitely as time passes —
 * estimates for ids created after the last anchor (2025-11-11) extrapolate
 * from the final segment's growth rate and get less reliable the further
 * out "now" drifts from that date.
 */
const ANCHOR_TABLE: readonly (readonly [isoDate: string, id: number])[] = [
  ["2013-08-14", 0],
  ["2013-11-01", 2768409],
  ["2013-12-31", 7679610],
  ["2014-02-01", 11538514],
  ["2014-02-20", 15835244],
  ["2014-02-26", 23646077],
  ["2014-03-01", 38015510],
  ["2014-05-06", 44634663],
  ["2014-05-15", 46145305],
  ["2014-09-20", 54845238],
  ["2014-10-27", 63263518],
  ["2015-03-06", 101260938],
  ["2015-03-13", 101323197],
  ["2015-04-21", 111220210],
  ["2015-07-23", 116812045],
  ["2015-07-24", 122600695],
  ["2015-08-17", 124872445],
  ["2015-09-03", 130029930],
  ["2015-10-07", 133909606],
  ["2015-11-06", 157242073],
  ["2016-03-09", 171295414],
  ["2016-04-10", 181783990],
  ["2016-06-08", 222021233],
  ["2016-06-18", 225034354],
  ["2016-09-10", 278941742],
  ["2016-10-18", 285253072],
  ["2016-11-19", 294851037],
  ["2016-12-16", 297621225],
  ["2017-01-28", 328594461],
  ["2017-02-21", 337808429],
  ["2017-02-22", 341546272],
  ["2017-02-24", 352940995],
  ["2017-03-31", 369669043],
  ["2017-07-31", 400169472],
  ["2019-07-15", 805158066],
  ["2021-10-12", 1974255900],
  ["2021-12-06", 5031711230],
  ["2022-01-13", 5045293264],
  ["2022-01-19", 5070164216],
  ["2022-01-22", 5149590651],
  ["2022-01-24", 5177789190],
  ["2022-01-27", 5288930461],
  ["2022-04-21", 5396515972],
  ["2022-05-27", 5505809357],
  ["2022-06-11", 5598262640],
  ["2022-08-28", 5694365966],
  ["2022-09-23", 5721138769],
  ["2022-10-07", 5735455201],
  ["2022-10-10", 5744374534],
  ["2022-10-30", 5765259845],
  ["2022-11-06", 5795660441],
  ["2022-11-19", 5931294587],
  ["2022-12-23", 5983753471],
  ["2023-02-12", 6271031786],
  ["2023-03-17", 6277658932],
  ["2023-07-07", 6326011828],
  ["2023-08-02", 6523424924],
  ["2023-09-25", 6684986493],
  ["2023-11-02", 6765129195],
  ["2023-11-06", 6827058708],
  ["2023-12-02", 6829119388],
  ["2023-12-15", 6947316117],
  ["2024-04-06", 7002435197],
  ["2024-04-19", 7104310277],
  ["2024-05-29", 7242296450],
  ["2024-06-10", 7254607307],
  ["2024-06-16", 7293965553],
  ["2024-06-20", 7409259451],
  ["2024-08-02", 7458668365],
  ["2024-09-19", 7832006200],
  ["2025-02-21", 8173852075],
  ["2025-07-09", 8179125032],
  ["2025-07-31", 8238766847],
  ["2025-08-08", 8369442459],
  ["2025-09-11", 8461579295],
  ["2025-11-05", 8480708838],
  ["2025-11-11", 8559682245],
];

const POINTS: readonly (readonly [id: number, time: number])[] = ANCHOR_TABLE.map(
  ([iso, id]) => [id, Date.parse(iso + "T00:00:00Z")] as const
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
      const ratio = curId === prevId ? 0 : (id - prevId) / (curId - prevId);
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
