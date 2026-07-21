import { describe, expect, it } from "vitest";
import { formatPermissionWarning, missingPermissionsFor, type BotPermissions } from "./adminCheck";

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
