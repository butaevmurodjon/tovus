import { describe, expect, it } from "vitest";
import { buildDigestMessage, TAG_ORDER } from "./monthlyDigest";
import { REASON_TAGS, type MonthlyDigestStats } from "@/lib/db/stats";
import type { ReasonTag } from "@/lib/db/types";

function stats(byTag: Partial<Record<ReasonTag, number>>): MonthlyDigestStats {
  const full: Record<ReasonTag, number> = {
    profanity: 0,
    scam: 0,
    apk: 0,
    phishing_link: 0,
    ads: 0,
    ai: 0,
    flood: 0,
    cas: 0,
    raid: 0,
    globalban: 0,
    other: 0,
    ...byTag,
  };
  const total = Object.values(full).reduce((a, b) => a + b, 0);
  return { total, byTag: full };
}

describe("buildDigestMessage", () => {
  it("renders the quiet-month copy for an all-zero month", () => {
    const message = buildDigestMessage(stats({}), "ru");
    expect(message).toContain("тихо и чисто");
    // No per-tag breakdown lines for an all-zero month.
    expect(message).not.toContain("Реклама:");
    expect(message).not.toContain("Мат:");
  });

  it("renders total + only the nonzero tag lines, in the fixed severity order", () => {
    const message = buildDigestMessage(stats({ ads: 5, profanity: 2 }), "ru");
    expect(message).toContain("Всего удалено: 7");
    expect(message).toContain("Реклама: 5");
    expect(message).toContain("Мат: 2");
    // Zero-count tags must not appear at all.
    expect(message).not.toContain("Мошеннические схемы:");
    expect(message).not.toContain("Опасные файлы:");
    expect(message).not.toContain("Флуд:");
    // Ads (higher severity) is listed before profanity, per TAG_ORDER.
    expect(message.indexOf("Реклама:")).toBeLessThan(message.indexOf("Мат:"));
  });

  it("a single-category month renders exactly one breakdown line", () => {
    const message = buildDigestMessage(stats({ cas: 3 }), "ru");
    const lines = message.split("\n");
    expect(lines).toEqual(["📊 Итоги месяца в группе", "Всего удалено: 3", "Заблокировано по базе CAS: 3"]);
  });

  it("renders the uz dictionary for uz lang", () => {
    const message = buildDigestMessage(stats({ scam: 1 }), "uz");
    expect(message).toContain("Алдов схемалари: 1");
  });
});

describe("TAG_ORDER", () => {
  // Regression: TAG_ORDER and stats.ts's REASON_TAGS are two independently
  // maintained enumerations of the same ReasonTag union. REASON_TAGS itself
  // is compile-time-exhaustive (see its Record-typed source in stats.ts), but
  // nothing ties TAG_ORDER to it — a tag present in one and missing from the
  // other compiles fine and only shows up as a silently wrong digest total or
  // a missing breakdown line weeks later. This test is that tie.
  it("covers every ReasonTag exactly once, matching stats.ts's REASON_TAGS", () => {
    const orderedTags = TAG_ORDER.map((entry) => entry.tag).sort();
    expect(orderedTags).toEqual([...REASON_TAGS].sort());
  });
});
