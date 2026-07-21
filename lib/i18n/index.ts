import ru from "./dictionaries/ru.json";
import uz from "./dictionaries/uz.json";

export type Lang = "ru" | "uz";

export const DEFAULT_LANG: Lang = "ru";

const dictionaries = { ru, uz } as const;

type Dict = typeof ru;

/** Telegram language_code -> our two supported locales. uz* -> uz-cyrl, everything else -> ru. */
export function detectLang(languageCode?: string | null): Lang {
  if (languageCode && languageCode.toLowerCase().startsWith("uz")) return "uz";
  return "ru";
}

export function isLang(value: unknown): value is Lang {
  return value === "ru" || value === "uz";
}

function getPath(obj: unknown, path: string[]): unknown {
  return path.reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/**
 * t("ru", "bot.deletedProfanity") or t("uz", "bot.warnedUser", { user: "@ivan", reason: "спам" })
 */
export function t(
  lang: Lang,
  key: string,
  params?: Record<string, string | number>
): string {
  const dict: Dict = dictionaries[lang] ?? dictionaries[DEFAULT_LANG];
  const path = key.split(".");
  let value = getPath(dict, path);
  if (typeof value !== "string") {
    value = getPath(dictionaries[DEFAULT_LANG], path);
  }
  if (typeof value !== "string") return key;
  if (!params) return value;
  return Object.entries(params).reduce(
    (str, [k, v]) => str.replaceAll(`{${k}}`, String(v)),
    value
  );
}

export function getDictionary(lang: Lang): Dict {
  return dictionaries[lang] ?? dictionaries[DEFAULT_LANG];
}
