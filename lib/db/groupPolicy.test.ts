import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory fake standing in for Upstash's REST client — real enough for
// get/set/sadd/smembers/sismember/srem, which is everything groups.ts and
// policy.ts touch. Built as a fake (not per-call vi.fn mocks) because these
// tests exercise real read-modify-write sequences across two modules
// sharing "the same Redis" — a fake makes that actually true instead of
// having to hand-script every intermediate return value.
function makeFakeRedis() {
  const store = new Map<string, unknown>();
  const sets = new Map<string, Set<string>>();
  return {
    async get<T>(key: string): Promise<T | null> {
      return (store.has(key) ? structuredClone(store.get(key)) : null) as T | null;
    },
    async set(key: string, value: unknown) {
      store.set(key, structuredClone(value));
      return "OK";
    },
    async del(key: string) {
      store.delete(key);
      return 1;
    },
    async sadd(key: string, member: string | number) {
      const s = sets.get(key) ?? new Set<string>();
      s.add(String(member));
      sets.set(key, s);
      return 1;
    },
    async srem(key: string, member: string | number) {
      sets.get(key)?.delete(String(member));
      return 1;
    },
    async smembers<T>(key: string): Promise<T> {
      return Array.from(sets.get(key) ?? []) as T;
    },
    async sismember(key: string, member: string | number) {
      return sets.get(key)?.has(String(member)) ? 1 : 0;
    },
  };
}

let fakeRedis: ReturnType<typeof makeFakeRedis>;

vi.mock("./redis", () => ({
  getRedis: () => fakeRedis,
}));

const { registerGroup, getGroupSettings, updateGroupSettings, clearGroupOverrides } = await import("./groups");
const { setPolicyField, clearPolicyField } = await import("./policy");

beforeEach(() => {
  fakeRedis = makeFakeRedis();
});

describe("bot-wide policy resolution", () => {
  it("a brand-new group inherits a policy field it never touched", async () => {
    await setPolicyField("antispam", false);
    await registerGroup(-100123, "Test group");

    const settings = await getGroupSettings(-100123);
    expect(settings?.antispam).toBe(false);
  });

  it("falls back to the hardcoded default for fields policy doesn't set", async () => {
    await setPolicyField("antispam", false);
    await registerGroup(-100123, "Test group");

    const settings = await getGroupSettings(-100123);
    // profanityFilter defaults to true and policy never touched it here.
    expect(settings?.profanityFilter).toBe(true);
  });

  it("a group's own explicit value always wins over policy", async () => {
    await setPolicyField("antispam", false);
    await registerGroup(-100123, "Test group");
    await updateGroupSettings(-100123, { antispam: true });

    // Policy changes again — the group's explicit choice must not move.
    await setPolicyField("antispam", true);
    const settings = await getGroupSettings(-100123);
    expect(settings?.antispam).toBe(true);
  });

  it("changing ONE field does not freeze every other field against future policy (regression)", async () => {
    await registerGroup(-100123, "Test group");
    await updateGroupSettings(-100123, { premium: true }); // unrelated field

    await setPolicyField("antispam", false);
    const settings = await getGroupSettings(-100123);
    // If updateGroupSettings had persisted the fully-resolved object instead
    // of a sparse patch, antispam would have been baked in at its
    // then-current (default) value and this policy change would be inert.
    expect(settings?.antispam).toBe(false);
  });

  it("a group registered before this feature shipped is unaffected by policy (safe migration)", async () => {
    // Simulates the old registerGroup behavior: every field already present
    // in the raw blob, exactly what existing production groups have today.
    await fakeRedis.set("group:-100999:settings", {
      chatId: -100999,
      title: "Pre-existing group",
      lang: "ru",
      createdAt: 0,
      antispam: true,
      profanityFilter: true,
    });
    await fakeRedis.sadd("bot:groups", -100999);

    await setPolicyField("antispam", false);
    const settings = await getGroupSettings(-100999);
    expect(settings?.antispam).toBe(true); // untouched by the new policy
  });

  it("clearGroupOverrides lets an existing group opt into policy for specific fields", async () => {
    await fakeRedis.set("group:-100999:settings", {
      chatId: -100999,
      title: "Pre-existing group",
      lang: "ru",
      createdAt: 0,
      antispam: true,
      profanityFilter: false,
    });

    await setPolicyField("antispam", false);
    await clearGroupOverrides(-100999, ["antispam"]);

    const settings = await getGroupSettings(-100999);
    expect(settings?.antispam).toBe(false); // now follows policy
    expect(settings?.profanityFilter).toBe(false); // untouched field stays as-is
  });

  it("clearPolicyField removes a field from policy, falling through to the hardcoded default", async () => {
    await setPolicyField("antispam", false);
    await registerGroup(-100123, "Test group");
    expect((await getGroupSettings(-100123))?.antispam).toBe(false);

    await clearPolicyField("antispam");
    expect((await getGroupSettings(-100123))?.antispam).toBe(true); // DEFAULT_GROUP_SETTINGS.antispam
  });
});
