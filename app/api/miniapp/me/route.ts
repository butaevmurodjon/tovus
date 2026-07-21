import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/telegram/miniAppAuth";
import { getUserLang, setUserLang } from "@/lib/db/userLang";
import { detectLang, isLang } from "@/lib/i18n";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const storedLang = await getUserLang(user.id);
  const lang = storedLang ?? detectLang(user.language_code);
  if (!storedLang) await setUserLang(user.id, lang);

  return NextResponse.json({ user, lang });
}

export async function PATCH(req: Request) {
  const user = authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!isLang(body?.lang)) {
    return NextResponse.json({ error: "invalid lang" }, { status: 400 });
  }
  await setUserLang(user.id, body.lang);
  return NextResponse.json({ ok: true, lang: body.lang });
}
