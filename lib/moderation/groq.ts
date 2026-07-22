import Groq from "groq-sdk";
import { getRedis } from "@/lib/db/redis";

const MODEL = "llama-3.3-70b-versatile";

export type QuotaPool = "free" | "pro";

// Conservative guards under the Groq free-tier limits for this model
// (30 RPM / 1K RPD / 12K TPM / 100K TPD as of 2026), split into two pools so a
// burst of free-tier groups can never starve a paying Pro group's quota — the
// "dedicated AI quota" perk. Numbers are a starting split, adjustable; they
// intentionally leave headroom under the account-wide ceiling.
const BUDGETS: Record<QuotaPool, { rpm: number; rpd: number; tpm: number; tpd: number }> = {
  pro: { rpm: 8, rpd: 300, tpm: 3500, tpd: 30_000 },
  free: { rpm: 17, rpd: 600, tpm: 6500, tpd: 60_000 },
};

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 400;
const REQUEST_TIMEOUT_MS = 6000;
const COMPLETION_TOKEN_BUDGET = 150;

let _client: Groq | null = null;
function getClient(): Groq {
  if (!_client) {
    _client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return _client;
}

async function withinCounterBudget(key: string, ttlSeconds: number, max: number): Promise<boolean> {
  const redis = getRedis();
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, ttlSeconds);
  return count <= max;
}

/** Approximate token count (~4 chars/token) so the TPM/TPD guards don't need a real tokenizer. */
function estimateTokens(text: string): number {
  return Math.ceil((SYSTEM_PROMPT.length + text.length) / 4) + COMPLETION_TOKEN_BUDGET;
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

/** All budgets must clear before we spend a Groq call; any one exhausted -> silent fallback. */
async function withinRateBudget(pool: QuotaPool, text: string): Promise<boolean> {
  const tokens = estimateTokens(text);
  const b = BUDGETS[pool];
  const [rpm, rpd, tpm, tpd] = await Promise.all([
    withinCounterBudget(`groq:${pool}:rpm`, 60, b.rpm),
    withinCounterBudget(`groq:${pool}:rpd`, 60 * 60 * 24, b.rpd),
    withinTokenBudget(`groq:${pool}:tpm`, 60, b.tpm, tokens),
    withinTokenBudget(`groq:${pool}:tpd`, 60 * 60 * 24, b.tpd, tokens),
  ]);
  return rpm && rpd && tpm && tpd;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface GroqClassification {
  violation: boolean;
  category: "spam" | "profanity" | "none";
  reason: string;
}

const SYSTEM_PROMPT = `You moderate messages in Telegram group chats (Russian and Uzbek, mixed scripts, possible obfuscation).
Decide if a message is advertising/spam (unsolicited ads, "DM me" recruitment, scams, mass promo) or contains disguised profanity that simple filters would miss.
Respond ONLY with compact JSON: {"violation": boolean, "category": "spam"|"profanity"|"none", "reason": string}.
"reason" must be a short phrase in Russian, e.g. "реклама заработка" or "не является нарушением".
Be conservative: normal conversation, jokes, and on-topic messages are NOT violations.`;

/**
 * Classify a borderline message via Groq. Returns null on any failure,
 * timeout, or rate-limit exhaustion so callers can silently fall back to
 * base rules — chat users must never see an error from this path.
 *
 * `pool` routes to the group's plan-appropriate budget — Pro groups draw from
 * a reserved slice that free-tier traffic can never exhaust, see BUDGETS above.
 */
export async function classifyWithGroq(text: string, pool: QuotaPool = "free"): Promise<GroqClassification | null> {
  if (!process.env.GROQ_API_KEY) return null;
  if (!(await withinRateBudget(pool, text))) return null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const completion = await getClient().chat.completions.create(
        {
          model: MODEL,
          temperature: 0,
          max_tokens: COMPLETION_TOKEN_BUDGET,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: text.slice(0, 2000) },
          ],
        },
        { signal: controller.signal }
      );
      clearTimeout(timeout);

      const raw = completion.choices[0]?.message?.content;
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<GroqClassification>;
      if (typeof parsed.violation !== "boolean") return null;
      return {
        violation: parsed.violation,
        category: parsed.category === "spam" || parsed.category === "profanity" ? parsed.category : "none",
        reason: parsed.reason ?? "",
      };
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const retriable = status === 429 || (status !== undefined && status >= 500) || status === undefined;
      if (!retriable || attempt === MAX_ATTEMPTS) return null;
      await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1) + Math.random() * 200);
    }
  }
  return null;
}
