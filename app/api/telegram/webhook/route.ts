import { getWebhookHandler } from "@/lib/telegram/bot";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  return getWebhookHandler()(req);
}
