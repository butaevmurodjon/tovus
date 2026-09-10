/**
 * Loading placeholders for the Mini App shell.
 *
 * Why these exist: every screen used to render a bare centred "Загрузка…"
 * while its fetch was in flight, then swap in TopBar + content + BottomNav all
 * at once. In Telegram's WebView that reads as the panel booting twice — the
 * chrome materialises from nothing and everything below it jumps. The layouts
 * now render the real header and nav immediately (they need no data) and drop
 * these blocks into the content area, so the only thing that changes on load
 * is the content itself.
 *
 * Deliberately no explicit colours beyond the shared tokens: `--border` is
 * already the "inert divider" grey of this design language, so a skeleton
 * built from it can never drift from the palette.
 */

/** One inert block. `className` carries the size (Tailwind height/width). */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-[var(--radius-sm)] ${className}`}
      style={{ background: "var(--border)" }}
      aria-hidden="true"
    />
  );
}

/**
 * A card-shaped placeholder matching the real cards' `rounded-[var(--radius-md)]
 * border p-4` geometry, so the swap to real content shifts nothing.
 * `lines` counts the muted rows under the title bar.
 */
export function SkeletonCard({ lines = 2 }: { lines?: number }) {
  return (
    <div
      className="rounded-[var(--radius-md)] border p-4"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <Skeleton className="h-3.5 w-1/3 mb-3" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className="h-3" />
        ))}
      </div>
    </div>
  );
}

/** The content-area placeholder used by both Mini App layouts. */
export function SkeletonScreen({ cards = 3, label }: { cards?: number; label: string }) {
  return (
    <div className="px-4 py-4 flex flex-col gap-3" role="status" aria-busy="true" aria-label={label}>
      {Array.from({ length: cards }, (_, i) => (
        <SkeletonCard key={i} lines={i === 0 ? 2 : 3} />
      ))}
    </div>
  );
}
