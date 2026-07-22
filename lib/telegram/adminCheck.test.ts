import { describe, expect, it } from "vitest";
import type { Api } from "grammy";
import { GrammyError } from "grammy";
import { formatPermissionWarning, isChatAdmin, missingPermissionsFor, type BotPermissions } from "./adminCheck";

const fullPerms: BotPermissions = { isAdmin: true, canDeleteMessages: true, canRestrictMembers: true };
const noRestrictPerms: BotPermissions = { isAdmin: true, canDeleteMessages: true, canRestrictMembers: false };

describe("missingPermissionsFor", () => {
  it("reports nothing missing when fully admin", () => {
    expect(missingPermissionsFor({ action: "ban" }, fullPerms)).toEqual([]);
  });

  it("does not require restrict for delete/warn actions", () => {
    expect(missingPermissionsFor({ action: "delete" }, noRestrictPerms)).toEqual([]);
    expect(missingPermissionsFor({ action: "warn" }, noRestrictPerms)).toEqual([]);
  });

  it("requires restrict for mute/ban actions", () => {
    expect(missingPermissionsFor({ action: "mute" }, noRestrictPerms)).toEqual(["restrict"]);
    expect(missingPermissionsFor({ action: "ban" }, noRestrictPerms)).toEqual(["restrict"]);
  });

  it("requires restrict when captcha or antiraid is on, even if action is delete (regression)", () => {
    expect(missingPermissionsFor({ action: "delete", captchaEnabled: true }, noRestrictPerms)).toEqual(["restrict"]);
    expect(missingPermissionsFor({ action: "delete", antiraidEnabled: true }, noRestrictPerms)).toEqual(["restrict"]);
  });
});

describe("formatPermissionWarning — attributes the restrict requirement correctly (regression)", () => {
  it("does not blame the configured action when captcha is the actual reason", () => {
    const text = formatPermissionWarning("ru", { action: "delete", captchaEnabled: true }, noRestrictPerms);
    expect(text).toContain("Капча");
    expect(text).not.toContain("удалить");
  });

  it("lists multiple reasons when several features need restrict at once", () => {
    const text = formatPermissionWarning(
      "ru",
      { action: "ban", captchaEnabled: true, antiraidEnabled: true },
      noRestrictPerms
    );
    expect(text).toContain("забанить");
    expect(text).toContain("Капча");
    expect(text).toContain("Антирейд");
  });

  it("returns null when nothing is missing", () => {
    expect(formatPermissionWarning("ru", { action: "ban" }, fullPerms)).toBeNull();
  });
});

describe("isChatAdmin", () => {
  function fakeApi(getChatMember: Api["getChatMember"]): Api {
    return { getChatMember } as unknown as Api;
  }

  it("returns true for administrator/creator", async () => {
    const api = fakeApi(async () => ({ status: "administrator" }) as never);
    expect(await isChatAdmin(api, 1, 2)).toBe(true);
  });

  it("returns false for a GrammyError (real answer, e.g. user not in chat) without retrying", async () => {
    let calls = 0;
    const api = fakeApi(async () => {
      calls++;
      throw new GrammyError("Bad Request", { ok: false, error_code: 400, description: "Bad Request" }, "getChatMember", {});
    });
    expect(await isChatAdmin(api, 1, 2)).toBe(false);
    expect(calls).toBe(1);
  });

  it("retries once on a transient failure instead of aborting the whole moderation path (regression)", async () => {
    let calls = 0;
    const api = fakeApi(async () => {
      calls++;
      if (calls === 1) throw new Error("network timeout");
      return { status: "member" } as never;
    });
    expect(await isChatAdmin(api, 1, 2)).toBe(false);
    expect(calls).toBe(2);
  });

  it("still throws after two consecutive transient failures, so the caller can decide how to fail closed", async () => {
    const api = fakeApi(async () => {
      throw new Error("network timeout");
    });
    await expect(isChatAdmin(api, 1, 2)).rejects.toThrow("network timeout");
  });
});
