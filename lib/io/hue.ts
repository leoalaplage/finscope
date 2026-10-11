/**
 * One colour per measure, wherever the measure is drawn.
 *
 * The terminal colours each figure — revenue the same blue on its small
 * multiple, on the big chart and in the legend, on every company — and the
 * document site, which draws in one ink, ignores the number. A measure is
 * known by its short name, which the small multiples and the chart's series
 * share. The eight a company page opens on have fixed places in the palette
 * so no two of them clash; anything else takes a place from its name.
 */

export const HUE_COUNT = 8;

const FIXED: Record<string, number> = {
  "revenue": 1,
  "operating income": 2,
  "net income": 3,
  "free cash flow": 4,
  "operating cf": 5,
  "fcf / share": 6,
  "operating margin": 7,
  "diluted shares": 8,
  // The share price, held against a measure, is drawn in the page's own ink.
  "share price": 0,
};

export function hueOf(name: string): number {
  const key = name.trim().toLowerCase();
  if (key in FIXED) return FIXED[key];
  let hash = 0;
  for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return (hash % HUE_COUNT) + 1;
}
