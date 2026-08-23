import { getRedis } from "@/lib/db/redis";
import { fetchWithTimeout } from "@/lib/http";
import { listAiRules } from "@/lib/db/aiRules";

const API_URL = "https://api.deepseek.com/chat/completions";
const MODEL = "deepseek-chat";

export type QuotaPool = "free" | "pro";

// Conservative guards so a burst of free-tier groups can never starve a
// paying Pro group's quota — the "dedicated AI quota" perk. Numbers
// intentionally leave headroom under the account-wide ceiling and are
// adjustable.
//
// Free's pool is deliberately the LARGER raw number, not a mistake: there are
// expected to be far more free groups than Pro ones (freemium funnel), so the
// free pool needs more headroom just to avoid falling back to base rules
// under normal free-tier volume. Pro's actual perk isn't a bigger number —
// it's a pool free-tier traffic can structurally never touch, so a paying
// group's quota can't be starved by anyone else's burst.
const BUDGETS: Record<QuotaPool, { rpm: number; rpd: number; tpm: number; tpd: number }> = {
  pro: { rpm: 8, rpd: 300, tpm: 3500, tpd: 30_000 },
  free: { rpm: 17, rpd: 600, tpm: 6500, tpd: 60_000 },
};

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 400;
const REQUEST_TIMEOUT_MS = 6000;
const COMPLETION_TOKEN_BUDGET = 150;

async function withinCounterBudget(key: string, ttlSeconds: number, max: number): Promise<boolean> {
  const redis = getRedis();
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, ttlSeconds);
  return count <= max;
}

/** Approximate token count (~4 chars/token) so the TPM/TPD guards don't need a
 * real tokenizer. Takes the actual system prompt used for this call (not the
 * base SYSTEM_PROMPT constant) since owner-defined rules (see
 * buildSystemPrompt) can make it materially longer. */
function estimateTokens(systemPrompt: string, text: string): number {
  return Math.ceil((systemPrompt.length + text.length) / 4) + COMPLETION_TOKEN_BUDGET;
}

/**
 * GET-then-compare-then-INCRBY would be a classic TOCTOU race: two concurrent
 * serverless invocations can both read the same `current` before either writes,
 * both see headroom, and both proceed — overshooting `max`. INCRBY first
 * (atomic in Redis) and check the result instead; if it pushed the total over
 * `max`, decrement the reservation back out so a request that's about to be
 * denied doesn't permanently eat into the rest of the window's headroom.
 */
async function withinTokenBudget(key: string, ttlSeconds: number, max: number, tokens: number): Promise<boolean> {
  const redis = getRedis();
  const next = await redis.incrby(key, tokens);
  if (next === tokens) await redis.expire(key, ttlSeconds);
  if (next > max) {
    await redis.decrby(key, tokens);
    return false;
  }
  return true;
}

/** All budgets must clear before we spend a DeepSeek call; any one exhausted -> silent fallback. */
async function withinRateBudget(pool: QuotaPool, systemPrompt: string, text: string): Promise<boolean> {
  const tokens = estimateTokens(systemPrompt, text);
  const b = BUDGETS[pool];
  const [rpm, rpd, tpm, tpd] = await Promise.all([
    withinCounterBudget(`deepseek:${pool}:rpm`, 60, b.rpm),
    withinCounterBudget(`deepseek:${pool}:rpd`, 60 * 60 * 24, b.rpd),
    withinTokenBudget(`deepseek:${pool}:tpm`, 60, b.tpm, tokens),
    withinTokenBudget(`deepseek:${pool}:tpd`, 60 * 60 * 24, b.tpd, tokens),
  ]);
  return rpm && rpd && tpm && tpd;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface DeepseekClassification {
  violation: boolean;
  category: "spam" | "profanity" | "scam" | "none";
  reason: string;
}

const SYSTEM_PROMPT = `You moderate messages in Telegram group chats (Russian and Uzbek, mixed scripts, possible obfuscation).
Decide if a message is advertising/spam (unsolicited ads, "DM me" recruitment, mass promo), a scam pattern (fake support agents, "напишите админу в лс" from someone who isn't an admin, financial-pyramid/investment scripts, phishing), or contains disguised profanity that simple filters would miss.
Respond ONLY with compact JSON: {"violation": boolean, "category": "spam"|"profanity"|"scam"|"none", "reason": string}.
"reason" must be a short phrase in Russian, e.g. "реклама заработка" or "не является нарушением".
Be conservative: normal conversation, jokes, and on-topic messages are NOT violations.`;

// Short in-memory cache so a burst of messages across every group doesn't
// each pay a Redis hgetall just to build the same prompt — owner-edited
// rules change rarely, and Fluid Compute commonly reuses the same instance
// across nearby invocations. Worst case, a just-added rule takes up to this
// long to apply everywhere; that's an acceptable trade for cutting Redis
// calls on the hottest AI path.
const AI_RULES_CACHE_TTL_MS = 30_000;
let aiRulesCache: { rules: Awaited<ReturnType<typeof listAiRules>>; expiresAt: number } | null = null;

async function getCachedAiRules(): Promise<Awaited<ReturnType<typeof listAiRules>>> {
  if (aiRulesCache && aiRulesCache.expiresAt > Date.now()) return aiRulesCache.rules;
  const rules = await listAiRules();
  aiRulesCache = { rules, expiresAt: Date.now() + AI_RULES_CACHE_TTL_MS };
  return rules;
}

/** Appends the owner's "teach the AI" rules (Mini App owner tools) to the base
 * prompt, if any are set. Global across all groups — see lib/db/aiRules.ts.
 * Fails open to the base prompt on any Redis error; a rules-fetch hiccup must
 * never block moderation, just temporarily drop the custom rules for one call. */
async function buildSystemPrompt(): Promise<string> {
  const rules = await getCachedAiRules().catch(() => []);
  if (rules.length === 0) return SYSTEM_PROMPT;

  const violations = rules.filter((r) => r.label === "violation").map((r) => `- ${r.text}`);
  const allowed = rules.filter((r) => r.label === "allowed").map((r) => `- ${r.text}`);

  let extra = "\n\nAdditional rules set by this bot's owner (apply these on top of the judgment above):";
  if (violations.length > 0) extra += `\nTreat these as violations:\n${violations.join("\n")}`;
  if (allowed.length > 0) extra += `\nDo NOT treat these as violations, even if they otherwise look borderline:\n${allowed.join("\n")}`;
  return SYSTEM_PROMPT + extra;
}

interface DeepseekResponse {
  choices?: { message?: { content?: string } }[];
}

/** Pure parse of the model's JSON content into a validated classification, or null on any malformed shape. */
export function parseDeepseekContent(raw: string | undefined): DeepseekClassification | null {
  if (!raw) return null;
  let parsed: Partial<DeepseekClassification>;
  try {
    parsed = JSON.parse(raw) as Partial<DeepseekClassification>;
  } catch {
    return null;
  }
  if (typeof parsed.violation !== "boolean") return null;
  const category =
    parsed.category === "spam" || parsed.category === "profanity" || parsed.category === "scam"
      ? parsed.category
      : "none";
  return { violation: parsed.violation, category, reason: parsed.reason ?? "" };
}

/**
 * Classify a borderline message via DeepSeek. Returns null on any failure,
 * timeout, or rate-limit exhaustion so callers can silently fall back to
 * base rules — chat users must never see an error from this path.
 *
 * `pool` routes to the group's plan-appropriate budget — Pro groups draw from
 * a reserved slice that free-tier traffic can never exhaust, see BUDGETS above.
 */
export async function classifyWithDeepseek(text: string, pool: QuotaPool = "free"): Promise<DeepseekClassification | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  const systemPrompt = await buildSystemPrompt();
  if (!(await withinRateBudget(pool, systemPrompt, text))) return null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetchWithTimeout(
        API_URL,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: MODEL,
            temperature: 0,
            max_tokens: COMPLETION_TOKEN_BUDGET,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: text.slice(0, 2000) },
            ],
          }),
        },
        REQUEST_TIMEOUT_MS
      );

      if (!res.ok) {
        const retriable = res.status === 429 || res.status >= 500;
        if (!retriable || attempt === MAX_ATTEMPTS) return null;
        await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1) + Math.random() * 200);
        continue;
      }

      const data = (await res.json()) as DeepseekResponse;
      return parseDeepseekContent(data.choices?.[0]?.message?.content);
    } catch {
      if (attempt === MAX_ATTEMPTS) return null;
      await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1) + Math.random() * 200);
    }
  }
  return null;
}
