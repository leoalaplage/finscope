import { NextResponse } from "next/server";
import { fetchQuotes } from "@/lib/adapters/spark";
import { cachedJson } from "@/lib/market-cache";
import { stripMembers, STRIP_SETS, type StripSet } from "@/lib/strips";

/**
 * One row of quotes, in one request to Yahoo rather than six.
 *
 * The commodities row fetches a chart per contract because it was written
 * before there was a batch reader; these two rows were written after, so six
 * symbols cost one call of about eighty milliseconds. Nothing here needs a
 * chart: a row is a figure and a move, and the panel a reader opens by
 * clicking asks for its own window.
 */
const TTL_SECONDS = 300;
const SHAPE = "v1";

const headers = {
  "Content-Type": "application/json",
  "Cache-Control": `public, max-age=60, s-maxage=${TTL_SECONDS}, stale-while-revalidate=900`,
};

export interface StripQuote {
  id: string;
  label: string;
  note: string;
  places: number;
  price: number | null;
  currency: string | null;
  changePercent: number | null;
  asOf: string | null;
}

export async function GET(request: Request) {
  // An unknown row is answered with the first rather than an error: the
  // parameter comes from a page a reader may have edited.
  const asked = new URL(request.url).searchParams.get("set");
  const set: StripSet = STRIP_SETS.includes(asked as StripSet) ? asked as StripSet : "world";
  const members = stripMembers(set);

  const { body } = await cachedJson<{ quotes: StripQuote[] }>(
    `strip:${SHAPE}:${set}`,
    TTL_SECONDS,
    async () => {
      // These are already Yahoo's own symbols, so they pass through untranslated.
      const quotes = await fetchQuotes(members.map((member) => member.symbol), (symbol) => symbol);
      return {
        quotes: members.map((member) => {
          const quote = quotes.get(member.symbol);
          return {
            id: member.id, label: member.label, note: member.note, places: member.places,
            price: quote?.price ?? null,
            currency: quote?.currency ?? null,
            // Yahoo states the move for an index and a currency alike; nothing
            // here is a percentage this application struck itself.
            changePercent: quote?.changePercent ?? null,
            asOf: quote?.asOf ?? null,
          };
        }),
      };
    },
    // A row where nothing priced is not worth keeping for five minutes.
    (value) => value.quotes.some((quote) => quote.price != null) ? "full" : "empty",
  );

  const parsed = JSON.parse(body) as { quotes: StripQuote[] };
  if (!parsed.quotes.some((quote) => quote.price != null)) {
    return NextResponse.json(parsed, { status: 502, headers: { ...headers, "Cache-Control": "no-store" } });
  }
  return new Response(body, { headers });
}
