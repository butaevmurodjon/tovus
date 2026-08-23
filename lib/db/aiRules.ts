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

// HLEN-then-HSET as separate round-trips would be a TOCTOU race: two
// concurrent addAiRule calls (e.g. a double-tap) could both read the same
// pre-write count, both see room, and both write — overshooting
// MAX_AI_RULES, the cap that exists to bound per-call DeepSeek token cost.
// Same fix as customWords.ts's ADD_BATCH_SCRIPT: a Lua script runs
// atomically on the Redis server, so the check and the write can't interleave.
const ADD_RULE_SCRIPT = `
local key = KEYS[1]
local max = tonumber(ARGV[1])
if redis.call('HLEN', key) >= max then return 0 end
redis.call('HSET', key, ARGV[2], ARGV[3])
return 1
`;

export async function addAiRule(
  label: AiRuleLabel,
  rawText: string
): Promise<{ added: boolean; rules: AiRule[] }> {
  const text = rawText.trim().slice(0, MAX_AI_RULE_LENGTH);
  if (!text) return { added: false, rules: await listAiRules() };

  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const rule: AiRule = { id, label, text, createdAt: Date.now() };
  const added = await getRedis().eval<[string, string, string], number>(
    ADD_RULE_SCRIPT,
    [key],
    [String(MAX_AI_RULES), id, JSON.stringify(rule)]
  );
  return { added: added === 1, rules: await listAiRules() };
}

export async function removeAiRule(id: string): Promise<AiRule[]> {
  await getRedis().hdel(key, id);
  return listAiRules();
}
