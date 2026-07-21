import Groq from "groq-sdk";
import { getRedis } from "@/lib/db/redis";

const MODEL = "llama-3.3-70b-versatile";

// Conservative guards under the Groq free-tier limits for this model
// (30 RPM / 1K RPD / 12K TPM / 100K TPD as of 2026). Shared across every
// premium group on this deployment's single API key, so these are budgets
// for the whole fleet, not per group.
const MAX_REQUESTS_PER_MINUTE = 25;
const MAX_REQUESTS_PER_DAY = 900;
const MAX_TOKENS_PER_MINUTE = 10_000;
const MAX_TOKENS_PER_DAY = 90_000;
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

async function withinTokenBudget(key: string, ttlSeconds: number, max: number, tokens: number): Promise<boolean> {
  const redis = getRedis();
  const current = Number((await redis.get<number>(key)) ?? 0);
  if (current + tokens > max) return false;
  const next = await redis.incrby(key, tokens);
  if (next === tokens) await redis.expire(key, ttlSeconds);
  return true;
}

/** All budgets must clear before we spend a Groq call; any one exhausted -> silent fallback. */
async function withinRateBudget(text: string): Promise<boolean> {
  const tokens = estimateTokens(text);
  const [rpm, rpd, tpm, tpd] = await Promise.all([
    withinCounterBudget("groq:rpm", 60, MAX_REQUESTS_PER_MINUTE),
    withinCounterBudget("groq:rpd", 60 * 60 * 24, MAX_REQUESTS_PER_DAY),
    withinTokenBudget("groq:tpm", 60, MAX_TOKENS_PER_MINUTE, tokens),
    withinTokenBudget("groq:tpd", 60 * 60 * 24, MAX_TOKENS_PER_DAY, tokens),
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
 */
export async function classifyWithGroq(text: string): Promise<GroqClassification | null> {
  if (!process.env.GROQ_API_KEY) return null;
  if (!(await withinRateBudget(text))) return null;

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
