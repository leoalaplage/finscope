/**
 * The QS Screener's engine, addressed from the application instead of an iframe.
 *
 * The three modules beside this file — `qs-config.js`, `qs-engine.js` and
 * `qs-parse.js` — are byte-for-byte the ones the standalone screener runs, and
 * a test asserts it. Nothing here recomputes a score, reweights a pillar,
 * re-anchors a metric or reorders a ranking: this file types the engine's
 * inputs and outputs so React can render them, and stops.
 *
 * The rendering it replaces was a PNG. An image cannot be sorted by clicking a
 * column, cannot be searched, cannot be read by a screen reader and cannot be
 * copied out one cell at a time — and it arrived inside an iframe carrying its
 * own theme, its own fonts and its own idea of what a table looks like. The
 * scores were never the problem; the picture of them was.
 */

import * as cfg from "./qs-config.js";
import { chargerTableau } from "./qs-parse.js";
import { analyser, trier, CRITERES_TRI, PILIERS } from "./qs-engine.js";

export type PillarName = "Quality" | "Health" | "Growth" | "Value";

/** The weights a reader can choose between, named as the engine names them. */
export type PresetName = keyof typeof cfg.PRESETS;

/**
 * One scored company, as the engine leaves it.
 *
 * Every field below is written by `calculerScores`; the names are the engine's
 * own, in its own language, because renaming them here would be a second
 * vocabulary to keep in step with the first.
 */
export interface ScoredCompany {
  Ticker: string;
  Secteur: string;
  Cap: number | null;
  brut: Record<string, number | null>;
  ref: Record<string, number | null>;
  piliers: Record<PillarName, number | null>;
  total: number | null;
  couverture: number;
  note: string;
  alertes: number;
  alertes_detail: string[];
  conviction: number | null;
  forces: Array<[string, number]>;
  faiblesses: Array<[string, number]>;
  valuation: string;
  valo_niveau: number;
  sweet_spot: boolean;
  qv_median: boolean;
  rang: number;
  rang_conviction: number;
  rang_secteur?: number;
  taille_secteur?: number;
  score_metrique: Record<string, number | null>;
}

export interface ScreenerFilters {
  preset?: PresetName;
  classerPar?: string;
  top?: number | "";
  minScore?: number | "";
  maxAlertes?: number | "";
  capMin?: number | "";
  notes?: string[];
  secteurs?: string[];
  valoAttractive?: boolean;
  sweetSpot?: boolean;
  winsoriser?: boolean;
  pilierMin?: Partial<Record<PillarName, number | "">>;
}

export interface ScreenerResult {
  /** Every company that parsed, scored against every other one. */
  all: ScoredCompany[];
  /** Those the filters kept, in the chosen order. */
  rows: ScoredCompany[];
  /** The pillar weights actually applied. */
  weights: Record<PillarName, number>;
  /** Metrics no company in the universe carried a usable value for. */
  missing: string[];
  warnings: string[];
}

/**
 * Reads the market-cap column in whatever unit it was written in.
 *
 * The screener's own column is titled "$Md" and every figure this application
 * generates is in billions, but an export pasted from somewhere else states the
 * same column in whole dollars as often as not — and the table then reported
 * Apple at 4,579,000,000 billion, which rendered as "4579000000.0T". Nothing
 * about the number is wrong; only the unit it is read in.
 *
 * The scale is inferred from the data rather than declared, because a paste
 * carries no unit. It is a safe inference: the divisor is chosen so the median
 * company lands somewhere between a hundred million and a hundred trillion, and
 * no two of the candidate divisors can both put it there — a universe stated in
 * dollars is a billion times away from one stated in billions, and there is
 * nothing in between to confuse it with.
 *
 * Market capitalisation is not a scored metric. It is a filter, a sort and a
 * column, so rescaling it moves no score; what it does move is the "minimum
 * cap" filter, which is exactly the thing that would otherwise silently keep
 * every company or none.
 */
const CAP_DIVISORS = [1, 1e3, 1e6, 1e9];

export function detectCapDivisor(values: Array<number | null>): number {
  const usable = values.filter((value): value is number => value != null && Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!usable.length) return 1;
  const median = usable[Math.floor(usable.length / 2)];
  // A hundred million to a hundred trillion, expressed in billions.
  const plausible = (value: number) => value >= 0.1 && value <= 1e5;
  return CAP_DIVISORS.find((divisor) => plausible(median / divisor)) ?? 1;
}

/** The pillars, the presets and the sort criteria, for the controls to offer. */
export const QS_PILLARS = PILIERS as PillarName[];
export const QS_PRESETS = cfg.PRESETS as Record<string, Record<PillarName, number>>;
export const QS_DEFAULT_WEIGHTS = cfg.POIDS_PILIERS as Record<PillarName, number>;
export const QS_GRADES = (cfg.GRILLE_NOTES as Array<[string, number]>).map(([grade]) => grade);
export const QS_METRIC_NAMES = cfg.NOMS_METRIQUES as Record<string, string>;
export const QS_METRIC_NOTES = cfg.DESCRIPTIONS_METRIQUES as Record<string, string>;
export const QS_COVERAGE_FLOOR = cfg.SEUIL_COUVERTURE as number;
export const QS_ALERT_PENALTY = cfg.MALUS_ALERTE as number;
export const QS_METRICS = cfg.METRIQUES as Array<{ cle: string; pilier: PillarName; poids: number; sens: "H" | "L" }>;

export const QS_SORTS = Object.entries(CRITERES_TRI as Record<string, { libelle: string }>)
  .map(([key, criterion]) => ({ key, label: criterion.libelle }));

/**
 * Scores a pasted or generated table.
 *
 * Throws with the parser's own message when the text cannot be read — those
 * messages name the missing column and quote the headers it did find, which is
 * more use to a reader than anything this layer could invent.
 */
export function screen(text: string, filters: ScreenerFilters = {}): ScreenerResult {
  const { titres, manquantes, avertissements } = chargerTableau(text) as {
    titres: ScoredCompany[]; manquantes: string[]; avertissements: string[];
  };

  const divisor = detectCapDivisor(titres.map((company) => company.Cap));
  if (divisor !== 1) {
    for (const company of titres) if (company.Cap != null) company.Cap /= divisor;
    avertissements.push(`Market cap was read in ${divisor === 1e9 ? "units" : divisor === 1e6 ? "thousands" : "millions"} and converted to billions.`);
  }

  const { titres: all, retenus, poids } = analyser(titres, filters) as {
    titres: ScoredCompany[]; retenus: ScoredCompany[]; poids: Record<PillarName, number>;
  };
  return { all, rows: retenus, weights: poids, missing: manquantes, warnings: avertissements };
}

/** Re-orders an already scored set without scoring it again. */
export function sortRows(rows: ScoredCompany[], criterion: string): ScoredCompany[] {
  return trier(rows, criterion) as ScoredCompany[];
}

export type SortDirection = "asc" | "desc";

interface Criterion { valeur: (row: ScoredCompany) => number | string | null | undefined; sens: number; texte?: boolean }

/**
 * What each column means, taken from the engine rather than restated.
 *
 * `CRITERES_TRI` already carries an accessor and a natural direction for every
 * ranking the screener offers, and those are exactly the columns on screen.
 * Reading them from there means a column header sorts by the same definition
 * the "Rank by" control uses, and that adding a criterion to the engine offers
 * it in both places at once.
 *
 * Two columns have no criterion because they are not rankings the engine ever
 * offered: the leading rank number, which is the total order by another name,
 * and the "above median on both Quality and Value" mark, which is a flag rather
 * than a score. Both are defined here, where presentation belongs.
 */
const LOCAL_CRITERIA: Record<string, Criterion> = {
  rang: { valeur: (row) => row.rang, sens: 1 },
  qv_median: { valeur: (row) => (row.qv_median ? 1 : 0), sens: -1 },
};

const criterionFor = (key: string): Criterion | null =>
  LOCAL_CRITERIA[key] ?? ((CRITERES_TRI as Record<string, Criterion>)[key] ?? null);

/** The direction a column opens in: the one that puts the best row on top. */
export function naturalDirection(key: string): SortDirection {
  return (criterionFor(key)?.sens ?? -1) < 0 ? "desc" : "asc";
}

/**
 * Sorts by any column, in either direction, with absences always last.
 *
 * The engine's own `trier` is deliberate about missing data — a company with no
 * value for a column is neither the best nor the worst at it, so it goes to the
 * bottom whichever way the column is pointing. Reversing its output would drag
 * every one of those rows to the top and read as though they had won. This
 * keeps that rule and applies the direction to the rows that do have a value.
 */
export function sortRowsBy(rows: ScoredCompany[], key: string, direction: SortDirection): ScoredCompany[] {
  const criterion = criterionFor(key);
  if (!criterion) return rows;
  const absent = (value: unknown) => value == null || (typeof value === "number" && !Number.isFinite(value));
  const factor = direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const a = criterion.valeur(left), b = criterion.valeur(right);
    if (absent(a) && absent(b)) return 0;
    if (absent(a)) return 1;
    if (absent(b)) return -1;
    return criterion.texte
      ? factor * String(a).localeCompare(String(b), "en")
      : factor * ((a as number) - (b as number));
  });
}

/**
 * The three-colour scale the printed dashboard used, as a CSS colour.
 *
 * Red at nought through yellow at fifty to green at a hundred — the same stops
 * and the same midpoint, so a reader who knows the exported image reads the
 * live table the same way. It is interpolated in sRGB, as it was there.
 */
export function scoreColour(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "var(--qs-empty)";
  const clamped = Math.max(0, Math.min(100, value));
  const red = [248, 105, 107], yellow = [255, 235, 132], green = [99, 190, 123];
  const [t, from, to] = clamped <= 50
    ? [clamped / 50, red, yellow]
    : [(clamped - 50) / 50, yellow, green];
  const channel = (index: number) => Math.round(from[index] + (to[index] - from[index]) * t);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

/** Black or white on that fill, by luminance — the dashboard's own rule. */
export function scoreInk(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "var(--muted)";
  const match = scoreColour(value).match(/\d+/g);
  if (!match) return "#141414";
  const [r, g, b] = match.map(Number);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#141414" : "#ffffff";
}

/** Every sector present, for the filter to offer only what the data holds. */
export function sectorsOf(rows: ScoredCompany[]): string[] {
  return [...new Set(rows.map((row) => row.Secteur).filter(Boolean))].sort((a, b) => a.localeCompare(b, "en"));
}

const CSV_COLUMNS: Array<[string, (row: ScoredCompany) => string | number | null]> = [
  ["Rank", (row) => row.rang],
  ["Ticker", (row) => row.Ticker],
  ["Sector", (row) => row.Secteur],
  ["Market cap ($Bn)", (row) => row.Cap],
  ["Quality", (row) => row.piliers.Quality],
  ["Health", (row) => row.piliers.Health],
  ["Growth", (row) => row.piliers.Growth],
  ["Value", (row) => row.piliers.Value],
  ["Total", (row) => row.total],
  ["Grade", (row) => row.note],
  ["Valuation", (row) => row.valuation],
  ["Risk-adjusted", (row) => row.conviction],
  ["Data coverage", (row) => row.couverture],
  ["Rank in sector", (row) => row.rang_secteur ?? null],
  ["Alerts", (row) => row.alertes],
  ["Alert detail", (row) => row.alertes_detail.join(" · ")],
  ["Above median Q+V", (row) => (row.qv_median ? "yes" : "no")],
  ["Sweet spot", (row) => (row.sweet_spot ? "yes" : "no")],
  ["Strengths", (row) => row.forces.map(([name]) => name).join(" · ")],
  ["Weaknesses", (row) => row.faiblesses.map(([name]) => name).join(" · ")],
];

const cell = (value: string | number | null) => {
  if (value == null) return "";
  const text = typeof value === "number" ? String(Number(value.toFixed(4))) : value;
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** The visible table as a file, with the detail the screen keeps folded away. */
export function resultsToCsv(rows: ScoredCompany[]): string {
  return [
    CSV_COLUMNS.map(([label]) => label).join(","),
    ...rows.map((row) => CSV_COLUMNS.map(([, read]) => cell(read(row))).join(",")),
  ].join("\n");
}
