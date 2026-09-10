import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * The Mini App moved from `/` to `/app` (GROWTH.md §3.2/§4.1) so that `/`
   * could become a server-rendered, indexable landing page.
   *
   * These redirects exist for links that were minted before the move and can
   * never be recalled: inline `web_app` buttons already sitting in group
   * chats, bookmarks, and BotFather menu buttons cached on clients. Permanent
   * (308) because the old paths are gone for good — 308 rather than 301 also
   * preserves the method, which matters for nothing here today but costs
   * nothing.
   *
   * `/owner` is listed separately from `/owner/:path*` because `:path*`
   * matches one-or-more segments in a redirect source, so the bare `/owner`
   * would otherwise fall through to a 404. `/group` needs no bare entry: no
   * page ever existed at `/group` itself, only at `/group/[groupId]`.
   *
   * NOTE: the URL fragment (`#tgWebAppData=…`, which is how Telegram delivers
   * initData) is never sent to the server, so it cannot be part of the match —
   * but browsers re-attach the original fragment to the redirect target, so
   * the Mini App still boots. The client-side bounce in
   * `components/TelegramBounce.tsx` covers the one case redirects cannot:
   * old links pointing at bare `/`, which must keep serving the landing page
   * to crawlers.
   */
  async redirects() {
    return [
      { source: "/owner", destination: "/app/owner", permanent: true },
      { source: "/owner/:path*", destination: "/app/owner/:path*", permanent: true },
      { source: "/group/:path*", destination: "/app/group/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
