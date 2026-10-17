/**
 * The terminal's colour palettes, on trial: the reader picks one in Settings,
 * and the one Tenqay keeps will become its identity. Each sets the surfaces
 * (background, panels, rules), the text and the accent; the charts keep their
 * own colours under every palette — a series is blue, a price green or red by
 * which way it went — so a chart reads the same whichever is chosen.
 *
 * Pure: the colours, and the CSS variables they become (app/terminal.css).
 */

export interface Palette {
  id: string;
  name: string;
  /** What it is, in a few words. */
  note: string;
  bg: string;
  raise: string;
  fill: string;
  head: string;
  line: string;
  lineStrong: string;
  ink: string;
  ink2: string;
  ink3: string;
  accent: string;
  /** Text on the accent. */
  accentInk: string;
}

export const PALETTES: Palette[] = [
  { id: "acid", name: "Acid", note: "Acid yellow on graphite — the current one",
    bg: "#0d1012", raise: "#12161a", fill: "#1a1f24", head: "#111519", line: "#1c2126", lineStrong: "#2c3238",
    ink: "#e9edf2", ink2: "#a1a8b0", ink3: "#6b737c", accent: "#f4e74c", accentInk: "#0d1012" },
  { id: "amber", name: "Amber", note: "Amber on black, the desk terminals' classic",
    bg: "#000000", raise: "#0a0a0a", fill: "#141414", head: "#080808", line: "#1a1a1a", lineStrong: "#2a2a2a",
    ink: "#ececec", ink2: "#a8a8a8", ink3: "#6e6e6e", accent: "#ffa028", accentInk: "#000000" },
  { id: "gold", name: "Signal gold", note: "Muted gold on blue-black",
    bg: "#0b0d10", raise: "#10141a", fill: "#171c23", head: "#0e1116", line: "#1a1f27", lineStrong: "#2a313b",
    ink: "#e6e9ee", ink2: "#9ea6b0", ink3: "#68707a", accent: "#e3b341", accentInk: "#0b0d10" },
  { id: "navy", name: "Navy & gold", note: "Gold on deep navy, a private bank's",
    bg: "#0a1222", raise: "#0e1729", fill: "#142036", head: "#0c1426", line: "#18243a", lineStrong: "#26354f",
    ink: "#e8edf6", ink2: "#a3aec2", ink3: "#6c7891", accent: "#f5c451", accentInk: "#0a1222" },
  { id: "cyan", name: "Cyan", note: "Cyan on slate",
    bg: "#0a1016", raise: "#0f161e", fill: "#152029", head: "#0c131a", line: "#17222c", lineStrong: "#26333f",
    ink: "#e6eef4", ink2: "#9fb0bd", ink3: "#677986", accent: "#22d3ee", accentInk: "#06232a" },
  { id: "blue", name: "Electric blue", note: "A bright blue on ink",
    bg: "#0a0e17", raise: "#0f1420", fill: "#161d2c", head: "#0c111c", line: "#18202f", lineStrong: "#283245",
    ink: "#e7ecf5", ink2: "#a0abbd", ink3: "#6a7488", accent: "#4f8cff", accentInk: "#ffffff" },
  { id: "emerald", name: "Emerald", note: "Green on a green-tinted black",
    bg: "#08110e", raise: "#0d1814", fill: "#13211b", head: "#0a140f", line: "#16241e", lineStrong: "#24362d",
    ink: "#e4f0ea", ink2: "#9db3a8", ink3: "#66796f", accent: "#34d399", accentInk: "#062016" },
  { id: "lime", name: "Lime", note: "Lime on near-black",
    bg: "#0b0f0c", raise: "#101611", fill: "#172019", head: "#0d120e", line: "#19221b", lineStrong: "#29342b",
    ink: "#e8efe9", ink2: "#a2ada4", ink3: "#6b766d", accent: "#a3e635", accentInk: "#0b0f0c" },
  { id: "coral", name: "Coral", note: "Coral on warm black",
    bg: "#120d0d", raise: "#181212", fill: "#221919", head: "#150f0f", line: "#241b1b", lineStrong: "#372a2a",
    ink: "#f3eaea", ink2: "#b5a5a5", ink3: "#7d6d6d", accent: "#ff6b57", accentInk: "#ffffff" },
  { id: "violet", name: "Violet", note: "Lavender on aubergine-black",
    bg: "#0e0b16", raise: "#14101f", fill: "#1d172b", head: "#110d1b", line: "#1f1a2d", lineStrong: "#302842",
    ink: "#ece8f6", ink2: "#aba3c0", ink3: "#736b89", accent: "#a78bfa", accentInk: "#120c22" },
  { id: "graphite", name: "Graphite", note: "Black, white and greys, no colour but the charts'",
    bg: "#111214", raise: "#16181b", fill: "#1e2024", head: "#141518", line: "#222428", lineStrong: "#33363c",
    ink: "#eceef1", ink2: "#a6aab1", ink3: "#6f747c", accent: "#e5e7eb", accentInk: "#111214" },
];

export const DEFAULT_PALETTE = PALETTES[0];

export const paletteById = (id: string | null | undefined): Palette => PALETTES.find((palette) => palette.id === id) ?? DEFAULT_PALETTE;

/** A palette as the terminal's CSS variables (app/terminal.css names them). */
export function paletteVariables(palette: Palette): Record<string, string> {
  return {
    "--bg": palette.bg,
    "--raise": palette.raise,
    "--fill": palette.fill,
    "--head": palette.head,
    "--line": palette.line,
    "--line-strong": palette.lineStrong,
    "--ink": palette.ink,
    "--ink-2": palette.ink2,
    "--ink-3": palette.ink3,
    "--inverse": palette.bg,
    "--amber": palette.accent,
    "--amber-ink": palette.accentInk,
    "--amber-dim": `color-mix(in srgb, ${palette.accent} 55%, transparent)`,
    "--shade": `color-mix(in srgb, ${palette.accent} 6%, transparent)`,
  };
}
