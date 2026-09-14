import { describe, expect, it, vi } from "vitest";
import type { Api } from "grammy";

vi.mock("@/lib/db/groups", () => ({
  listAllGroupIds: vi.fn(async () => [-100, -200]),
}));
vi.mock("@/lib/db/admins", () => ({
  // Admin 1 runs both groups — must be deduped, not messaged twice.
  listAllAdminUserIds: vi.fn(async () => [1, 2, 3]),
}));

const ORIGINAL_ENV = process.env.TELEGRAM_BOT_USERNAME;
process.env.TELEGRAM_BOT_USERNAME = "TovusBot";

const { broadcastToAdmins, broadcastToAllGroups } = await import("./broadcast");

type SendMessageArgs = [chatId: number, text: string, options?: unknown];

function fakeApi(sendMessage: ReturnType<typeof vi.fn<(...args: SendMessageArgs) => Promise<unknown>>>): Api {
  return { sendMessage } as unknown as Api;
}

describe("broadcastToAdmins", () => {
  it("sends once per deduped admin id, with a support button attached", async () => {
    const sendMessage = vi.fn(async (..._args: SendMessageArgs) => ({ message_id: 1 }));
    const result = await broadcastToAdmins(fakeApi(sendMessage), "hello");

    expect(result).toEqual({ total: 3, sent: 3, failed: 0 });
    expect(sendMessage).toHaveBeenCalledTimes(3);
    for (const call of sendMessage.mock.calls) {
      expect(call[1]).toBe("hello");
      expect(call[2]).toEqual({
        reply_markup: {
          inline_keyboard: [[{ text: "💬 Связь с поддержкой", url: "https://t.me/TovusBot?start=support" }]],
        },
      });
    }
  });

  it("counts a delivery failure (e.g. admin never started the bot) without throwing", async () => {
    const sendMessage = vi.fn(async (chatId: number, ..._rest: [string, unknown?]) => {
      if (chatId === 2) throw new Error("Forbidden: bot can't initiate conversation with a user");
      return { message_id: 1 };
    });
    const result = await broadcastToAdmins(fakeApi(sendMessage), "hello");
    expect(result).toEqual({ total: 3, sent: 2, failed: 1 });
  });

  it("omits the button entirely when TELEGRAM_BOT_USERNAME isn't set", async () => {
    delete process.env.TELEGRAM_BOT_USERNAME;
    const sendMessage = vi.fn(async (..._args: SendMessageArgs) => ({ message_id: 1 }));
    await broadcastToAdmins(fakeApi(sendMessage), "hello");
    expect(sendMessage.mock.calls[0][2]).toBeUndefined();
    process.env.TELEGRAM_BOT_USERNAME = ORIGINAL_ENV ?? "TovusBot";
  });
});

describe("broadcastToAllGroups", () => {
  it("still sends with no reply markup (unchanged behaviour)", async () => {
    const sendMessage = vi.fn(async (..._args: SendMessageArgs) => ({ message_id: 1 }));
    const result = await broadcastToAllGroups(fakeApi(sendMessage), "hi");
    expect(result).toEqual({ total: 2, sent: 2, failed: 0 });
    expect(sendMessage.mock.calls[0][2]).toBeUndefined();
  });
});
