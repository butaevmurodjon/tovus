import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

/**
 * Only routes that actually exist and are publicly reachable belong here.
 * Today that is `/` and `/privacy`; `/uz`, `/terms` and `/blog/*` are planned
 * (GROWTH.md §4.2) and must be added when those routes ship, not before —
 * a sitemap listing 404s is worse than a short sitemap.
 */
const LAST_MODIFIED = new Date("2026-09-10");

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      lastModified: LAST_MODIFIED,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${SITE_URL}/privacy`,
      lastModified: LAST_MODIFIED,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
