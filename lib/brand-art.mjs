/**
 * Tenqay's mark and wordmark, drawn as paths so they are the same everywhere: the terminal's bar, the charts'
 * watermarks, exported pictures, the browser's icons and the social preview, none of which can rely on a font.
 *
 * The letters are drawn after the terminal's own type, the system monospace (SF Mono, Menlo, Consolas): capitals on
 * one fixed advance, a tall oval O, square stroke ends. The mark is the monogram TQ in a thin frame over a gold rule,
 * the "research house" signature the wordmark carries as TENQAY | RESEARCH.
 *
 * Shared by React (components/BrandLogo.tsx) and the asset generator (scripts/generate-brand-assets.mjs).
 */
export const BRAND_NAME = "Tenqay";
export const BRAND_INK = "#0a1222";
export const BRAND_ACCENT = "#f5c451";
export const BRAND_PAPER = "#e8edf6";

/** Capitals on a 10 × 16 box, stroked: the monospace's proportions. */
const GLYPHS = {
  T: "M0 0H10M5 0V16",
  E: "M10 0H0V16H10M0 8H8",
  N: "M0 16V0L10 16V0",
  Q: "M5 0C1.2 0 0 3.4 0 8C0 12.6 1.2 16 5 16C8.8 16 10 12.6 10 8C10 3.4 8.8 0 5 0ZM6.2 11.6L10.4 17.4",
  A: "M0 16L5 0L10 16M1.9 10.4H8.1",
  Y: "M0 0L5 8L10 0M5 8V16",
  R: "M0 16V0H5.8C8.6 0 10 1.8 10 4.6C10 7.4 8.6 9.2 5.8 9.2H0M5.4 9.2L10 16",
  S: "M9.8 2.4C8.9 0.8 7.3 0 5 0C2.1 0 0.3 1.6 0.3 4C0.3 9.6 9.7 6.4 9.7 12C9.7 14.6 7.8 16 5 16C2.5 16 0.8 15 0 13.4",
  C: "M10 2.6C9 0.9 7.4 0 5.2 0C1.6 0 0 3.3 0 8C0 12.7 1.6 16 5.2 16C7.4 16 9 15.1 10 13.4",
  H: "M0 0V16M10 0V16M0 8H10",
};

/** A word of capitals on the fixed advance, as one path string per letter. */
function word(text, advance) {
  return [...text].map((letter, index) => ({ d: GLYPHS[letter], x: index * advance }));
}

const stroke = (width) => `fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="square" stroke-linejoin="miter" stroke-miterlimit="1.5"`;
const letters = (text, advance, width) => `<g ${stroke(width)}>${word(text, advance).map(({ d, x }) => `<path transform="translate(${x} 0)" d="${d}"/>`).join("")}</g>`;

/** The mark on 48 × 48: the frame, TQ, the gold rule. The accent is a class so a page can recolour it. */
export function markArtwork(accent = BRAND_ACCENT) {
  return `<rect x="2.2" y="2.2" width="43.6" height="43.6" ${stroke(2.4)}/>`
    + `<g transform="translate(10.2 10.5) scale(1.0625)">${letters("TQ", 16.4, 3.1)}</g>`
    + `<rect class="brand-acc" x="10" y="33.6" width="28" height="2.8" fill="${accent}"/>`;
}

/** TENQAY on 90 × 16, letters spaced as the signature's capitals are. */
export const WORDMARK_WIDTH = 90;
export function wordmarkArtwork() {
  return letters("TENQAY", 16, 2.6);
}

/** TENQAY | RESEARCH: the wordmark with its descriptor, for the welcome tour and the social preview. */
export const SIGNATURE_VIEWBOX = "-2 -3 172 22";
export function signatureArtwork(accent = BRAND_ACCENT) {
  return `${wordmarkArtwork()}<rect class="brand-acc" x="100" y="-2" width="2.6" height="20" fill="${accent}"/>`
    + `<g transform="translate(111 0) scale(0.45)">${letters("RESEARCH", 15, 3.4)}</g>`;
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
    + `<g color="${BRAND_PAPER}" transform="translate(14.7 16) scale(1.3)">${letters("TQ", 16.6, 3.2)}</g>`
    + `<rect x="14.7" y="43" width="34.6" height="4.6" fill="${BRAND_ACCENT}"/></svg>`;
}
