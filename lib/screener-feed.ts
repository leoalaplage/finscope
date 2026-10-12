import { qsValuationColumns } from "./qs-export";
import type { UniverseTable } from "./universe-build";
import { UNIVERSE, UNIVERSE_AS_OF, UNIVERSE_NAME } from "./universe";
import type { ConsensusTable } from "./screener-consensus";
import { SCREEN_FIELDS, type ScreenRow } from "./free-screener";
import { rsRatings, type Field } from "./term/rules";
import type { TechTable } from "./term/tech-universe";
import { stated } from "./sector";

export interface ScreenerFeed {
  name: string; asOf: string; members: number; building: boolean;
  rows: ScreenRow[];
  coverage: { fundamental: number; price: number; consensus: number; technical: number };
  refreshedAt: string;
}
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const percent = (value: number | null) => finite(value) ? value * 100 : null;
/** Weekends and market holidays fit within this window; abandoned rows do not. */
const recent = (date: string | undefined | null, days: number, now: Date) => {
  if (!date) return false;
  const age = now.getTime() - Date.parse(date);
  return Number.isFinite(age) && age >= -86_400_000 && age <= days * 86_400_000;
};

/** Three bounded, already-built snapshots joined by ticker. No provider calls. */
export function screenerFeed(universe: UniverseTable | null, technical: TechTable | null, consensus: ConsensusTable | null, now = new Date()): ScreenerFeed {
  const fundamental = new Map(universe?.rows.map((row) => [row.ticker, row]) ?? []);
  const techRows = (technical?.rows ?? []).filter((row) => recent(row.builtAt, 7, now));
  const ratings = rsRatings(techRows);
  const tech = new Map(techRows.map((row, at) => [row.ticker, { ...row, rating: ratings[at] }]));
  const forecasts = new Map(consensus?.rows.filter((row) => recent(row.asOf, 3, now)).map((row) => [row.ticker, row]) ?? []);
  const coverage = { fundamental: 0, price: 0, consensus: 0, technical: 0 };
  const rows = UNIVERSE.map((member): ScreenRow => {
    const f = fundamental.get(member.ticker), t = tech.get(member.ticker), e = forecasts.get(member.ticker);
    const quoted = universe?.prices[member.ticker];
    const quote = quoted && recent(quoted.asOf, 7, now) && finite(quoted.price) && quoted.price > 0 ? quoted : null;
    const compatible = quote?.currency != null && f?.qsPrice.currency != null && quote.currency === f.qsPrice.currency;
    const values: ScreenRow["values"] = Object.fromEntries(SCREEN_FIELDS.map((field) => [field.key, null]));
    const previous: ScreenRow["previous"] = {};
    const reasons: ScreenRow["reasons"] = {};
    if (f) {
      coverage.fundamental++;
      for (const field of SCREEN_FIELDS.filter((field) => field.source === "fundamental")) {
        const value = f.qs[field.key];
        values[field.key] = finite(value) ? field.key === "Long-term Debt to Assets" ? value * 100 : value : null;
      }
      Object.assign(values, qsValuationColumns(f.qsPrice, compatible ? quote!.price : null, quote?.currency));
    } else reasons.fundamental = "The financial row has not been built yet.";
    if (quote) coverage.price++;
    if (!compatible) reasons.valuation = quote && f ? "The quote and filings do not have a verified matching currency." : "A recent quote and filed share count are required.";
    if (e) {
      coverage.consensus++;
      // Nasdaq's US-listed EPS and targets are in USD. Never divide another currency into them.
      const usdPrice = quote?.currency === "USD" ? quote.price : null;
      const pe = usdPrice != null && finite(e.eps) && e.eps > 0 ? usdPrice / e.eps : null;
      values.forwardPe = pe;
      values.peg = pe != null && finite(e.growth) && e.growth > 0 ? pe / (e.growth * 100) : null;
      values.epsGrowth = percent(e.growth);
      values.epsRevision = percent(e.revision);
      values.targetUpside = usdPrice != null && finite(e.target) && e.target > 0 ? (e.target / usdPrice - 1) * 100 : null;
      values.buyShare = percent(e.buyShare);
      values.analysts = finite(e.analysts) ? e.analysts : null;
    } else reasons.consensus = "No consensus read within the last three days. The daily rotation fills coverage progressively.";
    if (t) {
      coverage.technical++;
      for (const field of SCREEN_FIELDS.filter((field) => field.source === "technical")) {
        const key = field.key.slice(5) as Field;
        const pair = t.values[key];
        values[field.key] = key === "rsRating" ? t.rating[0] : finite(pair?.[0]) ? pair[0] : null;
        previous[field.key] = key === "rsRating" ? t.rating[1] : finite(pair?.[1]) ? pair[1] : null;
      }
    } else reasons.technical = "No daily technical snapshot read within the last seven days.";
    return {
      ticker: member.ticker, name: member.name, sector: typeof f?.qs.Sector === "string" ? stated(f.qs.Sector) : null,
      currency: quote?.currency ?? f?.qsPrice.currency ?? null,
      values, previous, reasons,
      dates: { fundamental: f?.retrievedAt ?? null, price: quote?.asOf ?? null, consensus: e?.asOf ?? null, technical: t ? new Date(t.asOf * 1000).toISOString() : null },
      period: f?.periodLabel ?? null, epsBasis: e?.epsBasis ?? null, sharesBasis: f?.qsPrice.sharesBasis ?? null,
    };
  });
  return { name: UNIVERSE_NAME, asOf: UNIVERSE_AS_OF, members: UNIVERSE.length, building: coverage.fundamental < UNIVERSE.length, rows, coverage, refreshedAt: now.toISOString() };
}
