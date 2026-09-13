import { fetchQuotes, SPARK_BATCH } from "@/lib/adapters/spark";
import { BONDS } from "@/lib/bonds";
import { COMMODITIES } from "@/lib/commodities";
import { dailyYields } from "@/lib/daily-yield-store";
import { cachedJson } from "@/lib/market-cache";
import { CURRENCIES, WORLD_INDICES } from "@/lib/strips";

/**
 * Every market this page watches, in one answer.
 *
 * The page showed four grids of six cells, one under another, identical in
 * typography and shape: twenty-four boxes with nothing to say which mattered,
 * and the oil price six hundred pixels from the dollar it is quoted in. What
 * every terminal converged on instead is one dense table — a row an instrument,
 * columns aligned so the eye reads down a single kind of number, colour in the
 * change column alone.
 *
 * One object on screen has to be one request, or it is four grids again with
 * different borders. So this assembles the lot: the world's indices, the
 * commodities, the government yields and the currencies, each with a month of
 * closes for the line beside it.
 *
 * Cheap, because the batch reader takes twenty symbols at a time — a month of
 * closes for six instruments is 9KB and eighty milliseconds, measured — and
 * because the yields that no exchange quotes are already read and stored for
 * the bond strip.
 */
const TTL_SECONDS = 300;
/** v3: a note only where the row is ambiguous — and the day only on a yield. */
const SHAPE = "v3";

const headers = {
  "Content-Type": "application/json",
  "Cache-Control": `public, max-age=60, s-maxage=${TTL_SECONDS}, stale-while-revalidate=900`,
};

export type MarketGroup = "world" | "commodities" | "rates" | "currencies";

export interface MarketRow {
  id: string;
  label: string;
  group: MarketGroup;
  /** The level, price or yield, in the units it is quoted in. */
  last: number | null;
  /** How it is written: a price takes a currency, a level and a yield do not. */
  measure: "price" | "level" | "yield";
  currency: string | null;
  places: number;
  /** The day, in per cent — or in basis points where the row is a yield. */
  changePercent: number | null;
  changeBasisPoints: number | null;
  /** What the figure is of: a unit, a country, the day it was struck. */
  note: string;
  /** A month of closes, oldest first, for the line at the end of the row. */
  spark: number[];
}

export interface MarketsAnswer { rows: MarketRow[]; builtAt: string }

/** "a barrel" is a sentence; "barrel" is a column heading two inches wide. */
const shortUnit = (unit: string) => unit.replace(/^an? /, "").replace("million BTU", "MMBtu");

/** A month of daily closes for many symbols, in one request per twenty. */
async function monthOfCloses(symbols: string[]): Promise<Map<string, number[]>> {
  const series = new Map<string, number[]>();
  for (let at = 0; at < symbols.length; at += SPARK_BATCH) {
    const slice = symbols.slice(at, at + SPARK_BATCH);
    try {
      const response = await fetch(
        `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(slice.join(","))}&range=1mo&interval=1d`,
        { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 FinScope/1.0" } },
      );
      if (!response.ok) continue;
      const payload = await response.json() as { spark?: { result?: Array<{ symbol: string; response: Array<{ close?: Array<number | null>; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> }> } };
      for (const entry of payload.spark?.result ?? []) {
        const first = entry.response?.[0];
        const closes = first?.close ?? first?.indicators?.quote?.[0]?.close ?? [];
        const kept = closes.filter((close): close is number => close != null && Number.isFinite(close));
        if (kept.length > 1) series.set(entry.symbol.toUpperCase(), kept);
      }
    } catch {
      // A row without a line is still a row: the figure is the subject.
    }
  }
  return series;
}

export async function GET() {
  const { body } = await cachedJson<MarketsAnswer>(
    `markets:${SHAPE}`,
    TTL_SECONDS,
    async () => {
      /*
       * A note only where the row is ambiguous without one.
       *
       * The DAX does not need "Germany" and EUR / USD does not need "dollars
       * per euro" — the name is the note, and a column repeating it truncated
       * to "GERMA…" is worse than an empty one. Gold per ounce against copper
       * per pound is a real ambiguity, and so is the day a published curve was
       * struck on.
       */
      const yahoo = [
        ...WORLD_INDICES.map((each) => ({ ...each, note: "", group: "world" as const, measure: "level" as const })),
        ...COMMODITIES.map((each) => ({ id: each.id, symbol: each.symbol, label: each.label, note: shortUnit(each.unit), places: each.places, description: "", group: "commodities" as const, measure: "price" as const })),
        ...BONDS.filter((bond) => bond.feed.kind === "yahoo").map((bond) => ({
          id: bond.id, symbol: bond.feed.kind === "yahoo" ? bond.feed.symbol : "", label: bond.label,
          note: "", places: 3, description: "", group: "rates" as const, measure: "yield" as const,
        })),
        ...CURRENCIES.map((each) => ({ ...each, note: "", group: "currencies" as const, measure: "price" as const })),
      ];

      const symbols = yahoo.map((each) => each.symbol);
      const [quotes, series] = await Promise.all([
        // These are Yahoo's own symbols and must not be translated.
        fetchQuotes(symbols, (symbol) => symbol),
        monthOfCloses(symbols),
      ]);

      const rows: MarketRow[] = yahoo.map((each) => {
        const quote = quotes.get(each.symbol);
        const yieldRow = each.measure === "yield";
        return {
          id: each.id, label: each.label, group: each.group, measure: each.measure,
          last: quote?.price ?? null,
          currency: quote?.currency ?? null,
          places: each.places,
          changePercent: yieldRow ? null : quote?.changePercent ?? null,
          /*
           * A yield moves in hundredths of a point and is never spoken about
           * as a percentage of itself: four per cent going to four and a tenth
           * is "ten basis points", and "+2.5%" would be arithmetic nobody uses.
           */
          changeBasisPoints: yieldRow && quote?.price != null && quote.previousClose != null
            ? (quote.price - quote.previousClose) * 100 : null,
          /*
           * The day belongs to a yield and to nothing else here.
           *
           * A published curve is struck once and carries the morning it was
           * struck on; an index and a currency are quoted continuously and
           * saying "Sep 11" beside them is the noise this column was just
           * emptied of. The fallback used to apply to everything and refilled
           * it within five minutes of the change.
           */
          note: yieldRow ? quote?.asOf ?? "" : each.note,
          spark: series.get(each.symbol.toUpperCase()) ?? [],
        };
      });

      // Then the yields no exchange quotes, from the series already stored for
      // them: a central bank's own daily reading, last twenty-two of them.
      const published = BONDS.filter((bond) => bond.feed.kind !== "yahoo");
      for (const bond of published) {
        try {
          if (bond.feed.kind === "yahoo") continue;
          const observations = await dailyYields(bond.id, bond.feed);
          const last = observations.at(-1);
          const before = observations.at(-2);
          if (!last) continue;
          rows.push({
            id: bond.id, label: bond.label, group: "rates", measure: "yield",
            last: last.value, currency: null, places: 3,
            changePercent: null,
            changeBasisPoints: before ? (last.value - before.value) * 100 : null,
            note: last.date,
            spark: observations.slice(-22).map((observation) => observation.value),
          });
        } catch {
          // One curve going quiet costs one row, not the table.
        }
      }

      return { rows, builtAt: new Date().toISOString() };
    },
    (value) => value.rows.some((row) => row.last != null) ? "full" : "empty",
  );
  return new Response(body, { headers });
}
