/**
 * Tenqay's mark and wordmark, for the terminal's bar, the charts' watermarks, exported pictures, the browser's icons
 * and the social preview.
 *
 * The letters are set in the terminal's own type, the system monospace (SF Mono, Menlo, Consolas) in bold. The mark
 * is the monogram TQ in a thin frame over a gold rule, the "research house" signature the wordmark carries as
 * TENQAY | RESEARCH.
 *
 * Shared by React (components/BrandLogo.tsx) and the asset generator (scripts/generate-brand-assets.mjs).
 */
export const BRAND_NAME = "Tenqay";
export const BRAND_INK = "#0a1222";
export const BRAND_ACCENT = "#f5c451";
export const BRAND_PAPER = "#e8edf6";

/** The terminal's own type (app/terminal.css --sans): the system monospace, in bold. */
export const BRAND_FONT = "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, 'Cascadia Mono', Consolas, monospace";

/**
 * A word in the site's font, its baseline at `y`, stretched or tightened by its spacing to exactly `width` so the
 * logo keeps its proportions whichever monospace the reader's system has (SF Mono, Menlo, Consolas).
 */
// A monospace's advance is six tenths of its size; the spacing that fills the width is also given letter by letter,
// for the renderers that ignore textLength (the icon and preview generator's).
const text = (content, { x, y, size, width, anchor = "start" }) => {
  const spacing = Math.max(0, (width - content.length * 0.6 * size) / content.length);
  const start = anchor === "middle" ? x + spacing / 2 : x;
  return `<text x="${start}" y="${y}" font-family="${BRAND_FONT}" font-weight="700" font-size="${size}" letter-spacing="${spacing.toFixed(2)}" text-anchor="${anchor}" textLength="${width}" lengthAdjust="spacing" fill="currentColor">${content}</text>`;
};

const stroke = (width) => `fill="none" stroke="currentColor" stroke-width="${width}"`;

/** The mark on 48 × 48: the frame, TQ, the gold rule. The accent is a class so a page can recolour it. */
export function markArtwork(accent = BRAND_ACCENT) {
  return `<rect x="2.2" y="2.2" width="43.6" height="43.6" ${stroke(2.4)}/>`
    + text("TQ", { x: 24, y: 27.6, size: 23.5, width: 28, anchor: "middle" })
    + `<rect class="brand-acc" x="10" y="33.6" width="28" height="2.8" fill="${accent}"/>`;
}

/** TENQAY on 90 × 16, letters spaced as the signature's capitals are. */
export const WORDMARK_WIDTH = 90;
export function wordmarkArtwork() {
  return text("TENQAY", { x: 0, y: 16, size: 22, width: 90 });
}

/** TENQAY | RESEARCH: the wordmark with its descriptor, for the welcome tour and the social preview. */
export const SIGNATURE_VIEWBOX = "-2 -3 172 22";
export function signatureArtwork(accent = BRAND_ACCENT) {
  return `${wordmarkArtwork()}<rect class="brand-acc" x="100" y="-2" width="2.6" height="20" fill="${accent}"/>`
    + text("RESEARCH", { x: 111, y: 7.4, size: 10.2, width: 54 });
}

export const MARK_VIEWBOX = "0 0 48 48";
export const WORDMARK_VIEWBOX = "-2 -2 94 21";
/** The mark, then TENQAY at three fifths of its height. */
export const LOCKUP_VIEWBOX = "0 0 194 48";
export function lockupArtwork(accent = BRAND_ACCENT) {
  return `${markArtwork(accent)}<g transform="translate(62 12.6) scale(1.42)">${wordmarkArtwork()}</g>`;
}

export function brandArtwork(variant = "lockup", accent = BRAND_ACCENT) {
  return variant === "mark" ? markArtwork(accent) : variant === "wordmark" ? wordmarkArtwork() : variant === "signature" ? signatureArtwork(accent) : lockupArtwork(accent);
}

export function brandViewBox(variant = "lockup") {
  return variant === "mark" ? MARK_VIEWBOX : variant === "wordmark" ? WORDMARK_VIEWBOX : variant === "signature" ? SIGNATURE_VIEWBOX : LOCKUP_VIEWBOX;
}

/** A standalone SVG file of one variant, its ink in `color` and its rule in `accent`. */
export function brandSvg(variant = "lockup", color = BRAND_INK, accent = BRAND_ACCENT) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${brandViewBox(variant)}" color="${color}" role="img" aria-label="${BRAND_NAME}"><title>${BRAND_NAME}</title>${brandArtwork(variant, accent)}</svg>\n`;
}

/**
 * The browser's icon: the mark in gold on navy, its frame dropped for the icon's own rounded square and its strokes
 * thickened, so TQ still reads at sixteen pixels.
 */
export function iconSvg(size = 64) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}"><title>${BRAND_NAME}</title>`
    + `<rect width="64" height="64" rx="12" fill="${BRAND_INK}"/>`
    + `<g color="${BRAND_PAPER}">${text("TQ", { x: 32, y: 36.8, size: 29, width: 34.6, anchor: "middle" })}</g>`
    + `<rect x="14.7" y="43" width="34.6" height="4.6" fill="${BRAND_ACCENT}"/></svg>`;
}
