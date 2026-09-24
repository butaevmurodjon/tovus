import { describe, expect, it, vi, beforeEach } from "vitest";

const store: Record<string, unknown> = {};
vi.mock("@/lib/db/redis", () => ({
  getRedis: () => ({
    set: vi.fn(async (key: string, value: unknown) => {
      store[key] = value;
    }),
    get: vi.fn(async (key: string) => store[key] ?? null),
    del: vi.fn(async (key: string) => {
      delete store[key];
    }),
  }),
}));

const { lockChat, unlockChat, isLocked } = await import("./lockdown");

function fakeApi(existingPermissions: Record<string, boolean> | undefined) {
  return {
    getChat: vi.fn(async () => ({ id: -100, type: "supergroup", permissions: existingPermissions })),
    setChatPermissions: vi.fn(async () => true),
  } as unknown as import("grammy").Api;
}

describe("lockdown", () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
  });

  it("locks a chat, forcing every permission off", async () => {
    const api = fakeApi({ can_send_messages: true, can_send_photos: false });
    await lockChat(api, -100, 1);
    expect(await isLocked(-100)).toBe(true);
    const call = (api.setChatPermissions as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toMatchObject({ can_send_messages: false, can_send_photos: false });
  });

  it("restores the chat's own permissions on unlock, not a hardcoded default", async () => {
    const api = fakeApi({ can_send_messages: true, can_send_photos: false, can_send_polls: true });
    await lockChat(api, -100, 1);
    await unlockChat(api, -100);
    expect(await isLocked(-100)).toBe(false);
    const restoreCall = (api.setChatPermissions as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(restoreCall[1]).toMatchObject({ can_send_messages: true, can_send_photos: false, can_send_polls: true });
  });

  it("re-locking an already-locked chat does not snapshot the restricted state over the original", async () => {
    const api = fakeApi({ can_send_messages: true });
    await lockChat(api, -100, 1);
    await lockChat(api, -100, 1); // second lock call, e.g. a retried /lock
    await unlockChat(api, -100);
    const restoreCall = (api.setChatPermissions as ReturnType<typeof vi.fn>).mock.calls[2];
    expect(restoreCall[1]).toMatchObject({ can_send_messages: true });
  });

  it("falls back to sensible defaults on unlock when nothing was saved", async () => {
    const api = fakeApi(undefined);
    await unlockChat(api, -999);
    const call = (api.setChatPermissions as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].can_send_messages).toBe(true);
  });
});
