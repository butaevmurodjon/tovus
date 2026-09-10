import { ImageResponse } from "next/og";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/seo";

export const alt = `${SITE_NAME} — бот-модератор для Telegram-групп`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Rendered by satori, not a browser: no CSS variables, no Tailwind classes,
 * no external fonts or images. Colours are the literals from
 * app/globals.css (--page/--surface/--ink/--ink-muted/--accent), and every
 * container with more than one child sets display:flex explicitly because
 * satori has no block layout.
 */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#f9f9f7",
          padding: "72px 80px",
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 84,
              height: 84,
              borderRadius: 24,
              backgroundColor: "#eaf2fc",
            }}
          >
            {/* Drawn, not an emoji: satori has no emoji font on the Linux
                build image, so a 🛡 glyph would render as tofu in production. */}
            <svg width="46" height="46" viewBox="0 0 24 24" fill="#2a78d6">
              <path d="M12 1.5 3.75 5v6.2c0 5.15 3.52 9.96 8.25 11.3 4.73-1.34 8.25-6.15 8.25-11.3V5L12 1.5Z" />
            </svg>
          </div>
          <div
            style={{
              fontSize: 40,
              fontWeight: 700,
              color: "#0b0b0b",
              letterSpacing: "-0.5px",
            }}
          >
            {SITE_NAME}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              fontSize: 68,
              fontWeight: 700,
              lineHeight: 1.12,
              color: "#0b0b0b",
              letterSpacing: "-1.5px",
              maxWidth: 940,
            }}
          >
            Бот-модератор для Telegram-групп
          </div>
          <div style={{ fontSize: 32, lineHeight: 1.35, color: "#52514e", maxWidth: 900 }}>
            {SITE_TAGLINE}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* Four chips is the maximum this row fits at fontSize 26 inside the
              80px side padding — "Реклама и спам" was swapped for the shorter
              "Спам и скам" rather than adding a fifth chip, which would
              overflow. Verified by rendering at 1200×630. */}
          {["Мат", "Спам и скам", "Вирусные .apk", "RU / UZ"].map((chip) => (
            <div
              key={chip}
              style={{
                display: "flex",
                alignItems: "center",
                backgroundColor: "#ffffff",
                border: "2px solid #e1e0d9",
                borderRadius: 999,
                padding: "12px 26px",
                fontSize: 26,
                color: "#2a78d6",
                fontWeight: 600,
              }}
            >
              {chip}
            </div>
          ))}
        </div>
      </div>
    ),
    size
  );
}
