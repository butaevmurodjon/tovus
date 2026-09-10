import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

/**
 * robots.txt matching is prefix-based, not segment-based, so the disallow
 * entries intentionally carry NO trailing slash: `/app` closes both `/app`
 * itself and `/app/owner`, while `/app/` would leave the bare `/app` page
 * crawlable.
 *
 * `/app` is the whole Mini App — dashboard, group settings and the owner
 * panel all live under it since the move off `/` (GROWTH.md §3.2). One prefix
 * therefore covers everything that used to need three. The old `/owner` and
 * `/group` prefixes are deliberately NOT listed any more: `next.config.ts`
 * redirects them into `/app`, and a crawler that is told a URL is disallowed
 * never follows it far enough to learn it was only a redirect — leaving them
 * in would just be dead weight in the file.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api", "/app"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    // Yandex still reads the non-standard `Host` directive for the canonical
    // mirror; harmless for every other crawler.
    host: SITE_URL,
  };
}
