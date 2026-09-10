import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

/**
 * robots.txt matching is prefix-based, not segment-based, so the disallow
 * entries intentionally carry NO trailing slash: `/owner` closes both
 * `/owner` itself and `/owner/bans`, while `/owner/` would leave the bare
 * `/owner` page crawlable.
 *
 * `/app` does not exist yet — it is the future Mini App mount point
 * (GROWTH.md §3.2); disallowing it now costs nothing and avoids a forgotten
 * follow-up when the Mini App moves off `/`.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api", "/owner", "/group", "/app"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    // Yandex still reads the non-standard `Host` directive for the canonical
    // mirror; harmless for every other crawler.
    host: SITE_URL,
  };
}
