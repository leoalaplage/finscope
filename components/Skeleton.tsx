/**
 * The shape of what is coming, held open until it arrives.
 *
 * Every waiting moment in this application used to be the word "Loading…" in a
 * bordered box the size of one line — eleven different phrasings of it, none of
 * them the size of the thing they stood for. So the page arrived, jumped as
 * each panel landed, and jumped again; and a chart that takes a second to draw
 * looked like a fault rather than a chart taking a second to draw. Reserving
 * the space is what makes a slow page read as a loading page instead of a
 * broken one.
 *
 * The block carries the accessible label, so a screen reader hears "loading
 * the overview charts" once rather than a wall of anonymous boxes.
 */
export function Skeleton({ label, lines = 3, height, chart = false }: {
  /** What is loading, in the reader's terms. Announced, not drawn. */
  label: string;
  lines?: number;
  /** A fixed height, for something whose size is known — a chart, a panel. */
  height?: number;
  /** Draw one block the height of a plot rather than a stack of text lines. */
  chart?: boolean;
}) {
  return <div className="skeleton" role="status" aria-live="polite" aria-label={`Loading ${label}`}>
    {chart
      ? <span className="skeleton-block" style={{ height: height ?? 240 }} aria-hidden="true"/>
      : Array.from({ length: lines }, (unused, index) => (
          // The last line is short, the way a paragraph ends. A stack of
          // identical full-width bars reads as a table, not as text arriving.
          <span key={index} className="skeleton-line" style={{ width: index === lines - 1 ? "58%" : undefined }} aria-hidden="true"/>
        ))}
  </div>;
}

/**
 * A grid of cards, held open.
 *
 * The overview is four charts in a grid and the watchlist is a wall of cards.
 * Both collapsed to a single line of text while they loaded, so the page was
 * one height and then abruptly another.
 */
export function SkeletonCards({ label, count = 4, height = 150 }: { label: string; count?: number; height?: number }) {
  return <div className="skeleton-cards" role="status" aria-live="polite" aria-label={`Loading ${label}`}>
    {Array.from({ length: count }, (unused, index) => (
      <span key={index} className="skeleton-block" style={{ height }} aria-hidden="true"/>
    ))}
  </div>;
}

/**
 * A table, held open at roughly its own size.
 *
 * The header row is drawn a shade stronger than the body, so the block reads as
 * a table arriving rather than as an undifferentiated grey slab.
 */
export function SkeletonTable({ label, rows = 6 }: { label: string; rows?: number }) {
  return <div className="skeleton skeleton-table" role="status" aria-live="polite" aria-label={`Loading ${label}`}>
    <span className="skeleton-line skeleton-head" aria-hidden="true"/>
    {Array.from({ length: rows }, (unused, index) => <span key={index} className="skeleton-line" aria-hidden="true"/>)}
  </div>;
}
