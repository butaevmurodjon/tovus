import { describe, expect, it, vi } from "vitest";
import { FakeRedis } from "./fakeRedis";

const fake = new FakeRedis();
vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: () => fake },
}));

const { incrementReasonTag, getMonthlyDigestStats, getCachedBestDigestHour, dateKey } = await import("./stats");

describe("incrementReasonTag / getMonthlyDigestStats", () => {
  it("increments today's bucket and a same-day read reflects it", async () => {
    const chatId = 111;
    await incrementReasonTag(chatId, "ads");
    await incrementReasonTag(chatId, "ads");
    await incrementReasonTag(chatId, "scam");

    const now = new Date();
    const stats = await getMonthlyDigestStats(chatId, now, now);
    expect(stats.byTag.ads).toBe(2);
    expect(stats.byTag.scam).toBe(1);
    expect(stats.byTag.profanity).toBe(0);
    expect(stats.total).toBe(3);
  });

  it("does not leak counts across different chatIds", async () => {
    await incrementReasonTag(222, "apk");
    const now = new Date();
    const other = await getMonthlyDigestStats(333, now, now);
    expect(other.total).toBe(0);
  });

  it("a window that only covers days with no activity reports an all-zero total", async () => {
    const stats = await getMonthlyDigestStats(444, new Date("2020-01-01T00:00:00Z"), new Date("2020-01-05T00:00:00Z"));
    expect(stats.total).toBe(0);
    expect(Object.values(stats.byTag).every((n) => n === 0)).toBe(true);
  });
});

describe("getCachedBestDigestHour", () => {
  it("caches the first computed answer — a later change to the underlying hourly data on the same date doesn't change it", async () => {
    const chatId = 555;
    const date = dateKey(new Date());

    // Seeds via the real hourly-activity path (incrementHourlyActivity always
    // writes to the CURRENT UTC hour's bucket), so the "no seeded data at all"
    // baseline picks the DEFAULT_DIGEST_HOUR fallback (see pickBestDigestHour's
    // own tests for why that's 12) — the point here isn't which hour wins,
    // only that the first answer sticks despite the data changing under it.
    const first = await getCachedBestDigestHour(chatId, date);

    // Push a lot more activity into the current hour — if this weren't
    // cached, a second call would still land on the same hour anyway (only
    // one hour has any data), so that alone wouldn't prove caching. Instead,
    // reach into the FakeRedis store directly to plant activity on a
    // DIFFERENT, deterministic hour than whatever real-clock hour the first
    // call saw — a real recomputation would have to pick that hour instead.
    const otherHour = (new Date().getUTCHours() + 12) % 24;
    await fake.hincrby(`group:${chatId}:hourly:${date}`, String(otherHour), 1000);

    const second = await getCachedBestDigestHour(chatId, date);
    expect(second).toBe(first);
  });

  it("does not leak a cached hour across different chatIds", async () => {
    const date = dateKey(new Date());
    // chatId 777 gets a deliberately-seeded, deterministic best hour; chatId
    // 888 gets none at all and must fall back to the default independently —
    // if the cache key were missing chatId, this would return 777's answer.
    await fake.hincrby(`group:777:hourly:${date}`, "5", 1);
    const seeded = await getCachedBestDigestHour(777, date);
    const unseeded = await getCachedBestDigestHour(888, date);
    expect(seeded).toBe(5);
    expect(unseeded).toBe(12);
  });
});
