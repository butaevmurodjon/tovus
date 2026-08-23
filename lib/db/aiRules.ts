import { getRedis } from "./redis";

// Every active rule's text is injected into the DeepSeek system prompt on
// EVERY classified message (see lib/moderation/deepseek.ts) — these caps
// bound how much that can inflate per-call token cost, not just storage.
// 15 * 200 chars is ~3000 chars (~750 tokens) worst case, on top of the base
// prompt (~175 tokens) and the message itself — stays well inside even the
// tightest (pro) tpm budget as long as the owner doesn't max this out.
export const MAX_AI_RULES = 15;
export const MAX_AI_RULE_LENGTH = 200;

export type AiRuleLabel = "violation" | "allowed";

export interface AiRule {
  id: string;
  label: AiRuleLabel;
  text: string;
  createdAt: number;
}

// Single global hash, owner-scoped like bot:globalban — these rules apply to
// every group's DeepSeek classification, not one group's.
const key = "bot:airules";

export async function listAiRules(): Promise<AiRule[]> {
  const all = await getRedis().hgetall<Record<string, AiRule>>(key);
  if (!all) return [];
  return Object.values(all).sort((a, b) => a.createdAt - b.createdAt);
}

export async function addAiRule(
  label: AiRuleLabel,
  rawText: string
): Promise<{ added: boolean; rules: AiRule[] }> {
  const text = rawText.trim().slice(0, MAX_AI_RULE_LENGTH);
  if (!text) return { added: false, rules: await listAiRules() };

  const redis = getRedis();
  const count = await redis.hlen(key);
  if (count >= MAX_AI_RULES) return { added: false, rules: await listAiRules() };

  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const rule: AiRule = { id, label, text, createdAt: Date.now() };
  await redis.hset(key, { [id]: rule });
  return { added: true, rules: await listAiRules() };
}

export async function removeAiRule(id: string): Promise<AiRule[]> {
  await getRedis().hdel(key, id);
  return listAiRules();
}
