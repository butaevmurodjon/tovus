import { describe, expect, it, vi } from "vitest";
import type { Api } from "grammy";
import type { User } from "grammy/types";

// Minimal in-memory Redis stand-in covering exactly what captcha.ts calls
// (get/set/del/ttl/sadd/srem) — fakeRedis.ts's shared fixture doesn't cover
// `ttl`/`sadd`/`srem` (it was built for flood.ts's counter keys only), so a
// small local one avoids widening that shared fixture's contract for an
// unrelated caller.
class FakeCaptchaRedis {
  private store = new Map<string, unknown>();
  private ttls = new Map<string, number>();
  private sets = new Map<string, Set<string | number>>();

  async get<T>(key: string): Promise<T | null> {
    return (this.store.has(key) ? this.store.get(key) : null) as T | null;
  }
  async set(key: string, value: unknown, opts?: { ex?: number }): Promise<"OK"> {
    this.store.set(key, value);
    if (opts?.ex) this.ttls.set(key, opts.ex);
    return "OK";
  }
  async del(key: string): Promise<number> {
    this.ttls.delete(key);
    return this.store.delete(key) ? 1 : 0;
  }
  async ttl(key: string): Promise<number> {
    return this.ttls.get(key) ?? -1;
  }
  async sadd(key: string, member: string | number): Promise<number> {
    const set = this.sets.get(key) ?? new Set();
    set.add(member);
    this.sets.set(key, set);
    return 1;
  }
  async srem(key: string, member: string | number): Promise<number> {
    return this.sets.get(key)?.delete(member) ? 1 : 0;
  }
}

const fake = new FakeCaptchaRedis();
vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: () => fake },
}));

const { MAX_CAPTCHA_ATTEMPTS, MAX_RULES_TEXT_LENGTH, normalizeRulesText, startCaptcha, verifyCaptcha } =
  await import("./captcha");

function fakeApi(): Api {
  const edited: unknown[] = [];
  const restricted: unknown[] = [];
  const banned: number[] = [];
  const deleted: number[] = [];
  return {
    sendMessage: vi.fn(async () => ({ message_id: 42 })),
    editMessageText: vi.fn(async (...args: unknown[]) => {
      edited.push(args);
      return true;
    }),
    restrictChatMember: vi.fn(async (...args: unknown[]) => {
      restricted.push(args);
      return true;
    }),
    banChatMember: vi.fn(async (userId: number) => {
      banned.push(userId);
      return true;
    }),
    unbanChatMember: vi.fn(async () => true),
    deleteMessage: vi.fn(async (_chatId: number, messageId: number) => {
      deleted.push(messageId);
      return true;
    }),
    // Test-only introspection, not part of the real Api shape.
    __edited: edited,
    __banned: banned,
  } as unknown as Api;
}

const testUser: User = { id: 555, is_bot: false, first_name: "Test" };

describe("normalizeRulesText", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeRulesText("  Правила чата  ")).toBe("Правила чата");
  });

  it("caps length so the sendMessage call can't silently fail (regression)", () => {
    const huge = "a".repeat(10_000);
    expect(normalizeRulesText(huge).length).toBe(MAX_RULES_TEXT_LENGTH);
  });
});

describe("verifyCaptcha (math type — attempt limiting, regression)", () => {
  const stateKey = (chatId: number, userId: number) => `captcha:${chatId}:${userId}`;

  it("kicks after MAX_CAPTCHA_ATTEMPTS wrong guesses instead of allowing unlimited retries on the same board", async () => {
    const chatId = -2001;
    const api = fakeApi();
    await startCaptcha(api, chatId, testUser, "ru", { type: "math", timeoutSeconds: 120 });
    const key = stateKey(chatId, testUser.id);
    const initial = await fake.get<{ token: string; attempts: number }>(key);
    expect(initial).not.toBeNull();
    expect(initial!.attempts).toBe(0);

    // -9999 is outside randomMathQuestion's option range (0..~23) on every draw,
    // so it's guaranteed wrong regardless of which question is currently live.
    for (let i = 1; i < MAX_CAPTCHA_ATTEMPTS; i++) {
      const result = await verifyCaptcha(api, chatId, testUser, testUser.id, initial!.token, -9999, "ru");
      expect(result).toBe("wrong-answer");
      const state = await fake.get<{ attempts: number }>(key);
      expect(state!.attempts).toBe(i);
    }

    // The final wrong guess exhausts the limit: kicked, not just re-shown a new board.
    const last = await verifyCaptcha(api, chatId, testUser, testUser.id, initial!.token, -9999, "ru");
    expect(last).toBe("failed");
    expect(api.banChatMember).toHaveBeenCalledWith(chatId, testUser.id);
    expect(api.unbanChatMember).toHaveBeenCalledWith(chatId, testUser.id, { only_if_banned: true });
    expect(await fake.get(key)).toBeNull();
  });

  it("shows a freshly-edited question after a wrong guess (not the same fixed board)", async () => {
    const chatId = -2002;
    const api = fakeApi();
    await startCaptcha(api, chatId, testUser, "ru", { type: "math", timeoutSeconds: 120 });
    const key = stateKey(chatId, testUser.id);
    const initial = await fake.get<{ token: string }>(key);

    await verifyCaptcha(api, chatId, testUser, testUser.id, initial!.token, -9999, "ru");
    expect(api.editMessageText).toHaveBeenCalledTimes(1);
  });

  it("still passes on a correct answer within the attempt limit", async () => {
    const chatId = -2003;
    const api = fakeApi();
    await startCaptcha(api, chatId, testUser, "ru", { type: "math", timeoutSeconds: 120 });
    const key = stateKey(chatId, testUser.id);
    const state = await fake.get<{ token: string; correctAnswer: number }>(key);

    const result = await verifyCaptcha(api, chatId, testUser, testUser.id, state!.token, state!.correctAnswer, "ru");
    expect(result).toBe("ok");
    expect(api.banChatMember).not.toHaveBeenCalled();
    expect(await fake.get(key)).toBeNull();
  });

  it("a click from someone other than the target user never counts as an attempt", async () => {
    const chatId = -2004;
    const api = fakeApi();
    await startCaptcha(api, chatId, testUser, "ru", { type: "math", timeoutSeconds: 120 });
    const key = stateKey(chatId, testUser.id);
    const initial = await fake.get<{ token: string; attempts: number }>(key);

    const bystander: User = { id: 999, is_bot: false, first_name: "Bystander" };
    const result = await verifyCaptcha(api, chatId, bystander, testUser.id, initial!.token, -9999, "ru");
    expect(result).toBe("wrong-user");
    const state = await fake.get<{ attempts: number }>(key);
    expect(state!.attempts).toBe(0);
  });
});
