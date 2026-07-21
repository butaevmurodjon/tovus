/**
 * Starter word packs for the custom-words filter, keyed by vertical. These are
 * scam/spam trigger phrases specific to each industry's common fraud patterns —
 * NOT profanity, which stays in profanityDict.ts. Treat these as a reviewable
 * starting point an admin can prune/extend via /customwords, not an
 * authoritative or exhaustive list — same honesty rule as the profanity dict.
 */
export type PresetKey = "agro" | "ecommerce" | "edtech" | "finance";

export const PRESET_KEYS: PresetKey[] = ["agro", "ecommerce", "edtech", "finance"];

export const PRESETS: Record<PresetKey, string[]> = {
  // Fake subsidy/grant schemes and fake input (seed/fertilizer) clearance sales
  // are the dominant scam pattern targeting farmers in the region.
  agro: [
    "бесплатные субсидии",
    "гарантированный грант фермерам",
    "дешёвые удобрения оптом",
    "семена по акции только сегодня",
    "деҳқонларга текин субсидия",
    "арзон уруғ фақат бугун",
    "давлат дотацияси кафолат",
  ],
  ecommerce: [
    "розыгрыш призов подпишись",
    "официальный магазин скидка 90",
    "верните деньги за заказ спишите",
    "дубликат аккаунта магазина",
    "sovg'a yutuq obuna bo'ling",
    "rasmiy do'kon 90 chegirma",
  ],
  edtech: [
    "куплю диплом без экзаменов",
    "напишу диплом на заказ гарантия",
    "куплю сертификат об окончании",
    "грант на обучение бесплатно только сегодня",
    "diplomni imtihonsiz sotib olaman",
    "bepul o'qish granti faqat bugun",
  ],
  // MLM/pyramid recruiting and crypto "double your deposit" scams — the dominant
  // scam pattern in generic/finance-adjacent groups, cutting across all verticals.
  finance: [
    "пассивный доход без вложений",
    "удвоим ваш депозит за неделю",
    "инвестируй и получай процент каждый день",
    "приглашай друзей и зарабатывай без вложений",
    "крипто кошелёк удвоение баланса гарантия",
    "сармоясиз пассив даромад",
    "бир ҳафтада омонатингизни икки баравар қиламиз",
    "дўстингизни таклиф қил ва пул топ",
  ],
};

export function isPresetKey(value: string): value is PresetKey {
  return (PRESET_KEYS as string[]).includes(value);
}
