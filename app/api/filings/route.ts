import { filingsForLatestDay } from "@/lib/edgar-daily";
import { cachedJson } from "@/lib/market-cache";

/**
 * The day's filings from the companies this site follows.
 *
 * What replaced a general news wire, and the reason is one measurement: of the
 * eighteen headlines that wire carried, ten were political, six were about
 * wars, one was a Formula One result and one was about a company. This is a
 * market page.
 *
 * Cached for a quarter of an hour. The index is published once and then
 * appended to through the day, so re-reading it every fifteen minutes is as
 * current as the source gets and costs the SEC one file.
 */
const TTL_SECONDS = 900;
const SHAPE = "v1";

const headers = {
  "Content-Type": "application/json",
  "Cache-Control": `public, max-age=300, s-maxage=${TTL_SECONDS}, stale-while-revalidate=1800`,
};

export interface FilingItem {
  ticker: string;
  name: string;
  form: string;
  accession: string;
  cik: string;
}

export interface FilingsAnswer {
  date: string;
  items: FilingItem[];
}

export async function GET() {
  /*
   * The key carries the day so a new one is a new answer rather than a wait.
   *
   * Without it, the first reader after midnight would hold yesterday's list
   * for fifteen minutes — which is the sort of small staleness that is
   * invisible and wrong.
   */
  const today = new Date().toISOString().slice(0, 10);
  const { body } = await cachedJson<FilingsAnswer>(
    `filings:${SHAPE}:${today}`,
    TTL_SECONDS,
    async () => {
      const day = await filingsForLatestDay();
      if (!day) return { date: today, items: [] };
      return {
        date: day.date,
        items: day.filings.map((filing) => ({
          ticker: filing.ticker, name: filing.name, form: filing.form, accession: filing.accession, cik: filing.cik,
        })),
      };
    },
    // A day with nothing in it is a real answer on a Sunday, but not one worth
    // holding for a quarter of an hour in case the index was simply late.
    (value) => value.items.length ? "full" : "empty",
  );
  return new Response(body, { headers });
}
