import { getRedis } from "./redis";
import { isLang, type Lang } from "@/lib/i18n";

const key = (userId: number) => `user:${userId}:lang`;

export async function getUserLang(userId: number): Promise<Lang | null> {
  const value = await getRedis().get<string>(key(userId));
  return isLang(value) ? value : null;
}

export async function setUserLang(userId: number, lang: Lang): Promise<void> {
  await getRedis().set(key(userId), lang);
}
