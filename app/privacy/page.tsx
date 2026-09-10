import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/seo";

/**
 * Public privacy policy — required by Telegram Apps Center and ProductHunt
 * (GROWTH.md §4.2). Content is a hand-conversion of PRIVACY.md at the repo
 * root; PRIVACY.md remains the source of truth, so edit both together.
 *
 * Deliberately a Server Component with no client JS: this is the one route
 * a crawler can actually read today.
 *
 * The text is English (as PRIVACY.md is) inside a `lang="ru"` document, hence
 * the explicit lang="en" on the article.
 */

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "What the Telegram moderation bot stores, for how long, what is sent to the DeepSeek API, and how to have your data removed.",
  alternates: { canonical: "/privacy" },
  openGraph: {
    title: `Privacy — ${SITE_NAME}`,
    description:
      "What the Telegram moderation bot stores, for how long, what is sent to the DeepSeek API, and how to have your data removed.",
    url: "/privacy",
    siteName: SITE_NAME,
    locale: "ru_RU",
    type: "article",
    // A page-level `openGraph` object REPLACES the parent's rather than
    // merging, so the root app/opengraph-image.tsx convention is not applied
    // here — verified against the rendered <head>. Point at it explicitly.
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: `${SITE_NAME} — бот-модератор для Telegram-групп`,
      },
    ],
  },
};

const RETENTION_ROWS: [string, string, string][] = [
  [
    "Group settings, admin list, member counts",
    "Redis",
    "until the bot is removed from the group",
  ],
  [
    "Deleted-message journal (text, sender name/id, reason)",
    "Redis",
    "last 300 entries per group",
  ],
  [
    "Recent message text + sender id/username (for “who posted this” / ban cleanup)",
    "Redis",
    "30 days",
  ],
  [
    "Aggregate counters (message counts, violation counts, hourly activity)",
    "Redis",
    "90 days",
  ],
  ["User reputation score (per group)", "Redis", "30 days of inactivity"],
];

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="text-[17px] font-semibold mt-8 mb-2.5"
      style={{ color: "var(--ink)" }}
    >
      {children}
    </h2>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[14px] leading-relaxed mb-3" style={{ color: "var(--ink-secondary)" }}>
      {children}
    </p>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code
      className="rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[13px]"
      style={{ backgroundColor: "var(--surface-sunken)", color: "var(--ink)" }}
    >
      {children}
    </code>
  );
}

export default function PrivacyPage() {
  return (
    <main className="flex-1 px-4 py-8">
      <article lang="en" className="mx-auto w-full max-w-[720px]">
        <h1 className="text-[26px] font-bold tracking-tight" style={{ color: "var(--ink)" }}>
          Privacy
        </h1>
        <p className="text-[13px] mt-1.5 mb-2" style={{ color: "var(--ink-muted)" }}>
          {SITE_NAME} — Telegram moderation bot and admin Mini App.
        </p>

        <H2>What the bot stores during normal operation</H2>

        <div
          className="overflow-x-auto rounded-[var(--radius-md)] border"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
        >
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr style={{ backgroundColor: "var(--surface-sunken)" }}>
                <th
                  className="text-left font-semibold px-3 py-2.5"
                  style={{ color: "var(--ink)", borderBottom: "1px solid var(--border)" }}
                >
                  Data
                </th>
                <th
                  className="text-left font-semibold px-3 py-2.5"
                  style={{ color: "var(--ink)", borderBottom: "1px solid var(--border)" }}
                >
                  Where
                </th>
                <th
                  className="text-left font-semibold px-3 py-2.5"
                  style={{ color: "var(--ink)", borderBottom: "1px solid var(--border)" }}
                >
                  Retention
                </th>
              </tr>
            </thead>
            <tbody>
              {RETENTION_ROWS.map(([data, where, retention]) => (
                <tr key={data}>
                  <td
                    className="px-3 py-2.5 align-top"
                    style={{ color: "var(--ink-secondary)", borderTop: "1px solid var(--border)" }}
                  >
                    {data}
                  </td>
                  <td
                    className="px-3 py-2.5 align-top whitespace-nowrap"
                    style={{ color: "var(--ink-secondary)", borderTop: "1px solid var(--border)" }}
                  >
                    {where}
                  </td>
                  <td
                    className="px-3 py-2.5 align-top"
                    style={{ color: "var(--ink-secondary)", borderTop: "1px solid var(--border)" }}
                  >
                    {retention}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-[14px] leading-relaxed mt-4 mb-3" style={{ color: "var(--ink-secondary)" }}>
          No message content is sent to third parties except: messages a{" "}
          <strong style={{ color: "var(--ink)" }}>premium</strong>-mode group explicitly opts into
          having classified by the DeepSeek API (only borderline cases are sent; DeepSeek&rsquo;s
          data-retention terms apply).
        </p>

        <H2>Training-corpus collection (optional, off by default)</H2>

        <P>
          When the operator enables <Code>CORPUS_ENABLED</Code>, the bot additionally retains a
          sample of messages from moderated groups —{" "}
          <strong style={{ color: "var(--ink)" }}>
            raw text together with the sender&rsquo;s Telegram id, username and display name
          </strong>{" "}
          — to build a labelled dataset for improving spam / scam / profanity detection. On this
          sample:
        </P>

        <ul className="mb-3 pl-5 list-disc text-[14px] leading-relaxed" style={{ color: "var(--ink-secondary)" }}>
          <li className="mb-1.5">
            A small fraction of non-premium traffic may be sent to the DeepSeek API for a shadow
            classification whose result is logged but{" "}
            <strong style={{ color: "var(--ink)" }}>never enforced</strong>.
          </li>
          <li>
            Admin actions (<Code>/spam</Code>, <Code>/ham</Code>, restoring a deleted message,
            manually banning a member) attach a confirmed label to the corresponding sample.
          </li>
        </ul>

        <P>
          This data is accessible only to the bot operator, is capped in volume, and — once moved to
          the durable store — is deleted after <Code>CORPUS_RETENTION_DAYS</Code> days (default
          180). It is used solely to tune this bot&rsquo;s filters and is not shared or sold.
        </P>

        <div
          className="rounded-[var(--radius-md)] border p-3.5 my-4"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--status-warning-wash)" }}
        >
          <p className="text-[13px] leading-relaxed" style={{ color: "var(--ink-secondary)" }}>
            <strong style={{ color: "var(--ink)" }}>Operators:</strong> enabling{" "}
            <Code>CORPUS_ENABLED</Code> in production means retaining user message content and
            identity beyond the 30-day window above. Disclose this to your group members (e.g. in
            the <Code>/start</Code> text and group rules) before turning it on, and confirm it is
            compatible with Telegram&rsquo;s Terms of Service and any local data-protection law that
            applies to you.
          </p>
        </div>

        <H2>Removing your data</H2>

        <P>
          Remove the bot from a group and its per-group settings, journal and counters stop being
          updated and age out on the retention windows above. For corpus data tied to a specific
          user or group, contact the bot operator.
        </P>
      </article>
    </main>
  );
}
