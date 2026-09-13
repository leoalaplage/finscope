import { NextResponse } from "next/server";
import { qsTable, qsValuationColumns, type QsRow } from "@/lib/qs-export";
import { screen, type ScoredCompany } from "@/lib/qs/screener";
import { readUniverse } from "@/lib/universe-build";
import { TICKER_PATTERN } from "@/lib/market-profile";

/**
 * What a company's own industry is priced at.
 *
 * A page can say a company trades at twenty-eight times its free cash flow and
 * leave the reader with the only question that matters unanswered: against
 * what. Against its own history, which the chart above already shows — and
 * against the businesses that do the same thing, which nothing here could show
 * until there was an index to compare against.
 *
 * This is a valuation panel and deliberately not a ranking of the score. The
 * grade on this page is struck against fixed anchors and says something about
 * the company rather than about whoever it was scored beside; peers do not
 * make it better or worse. What peers do is turn a multiple into a reading.
 *
 * Everything comes from the table the scheduled run already assembles, so this
 * is a read and a sort rather than five hundred requests.
 */
const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=900",
};

export interface PeerRow {
  ticker: string;
  name: string;
  /** The letter the fixed anchors give it, or "NR" where coverage is short. */
  grade: string;
  total: number | null;
  marketCap: number | null;
  evEbit: number | null;
  evFcf: number | null;
  fcfYield: number | null;
}

export interface PeersAnswer {
  sector: string;
  /** The index this cohort is drawn from, and the day its membership was taken. */
  index: string;
  asOf: string;
  builtAt: string;
  subject: string;
  /** Every company in the sector, largest first. */
  peers: PeerRow[];
  /** The middle of the sector on each measure, which is what a multiple is read against. */
  medians: { marketCap: number | null; evEbit: number | null; evFcf: number | null; fcfYield: number | null };
}

const median = (values: Array<number | null | undefined>): number | null => {
  const kept = values.filter((value): value is number => value != null && Number.isFinite(value)).sort((a, b) => a - b);
  if (!kept.length) return null;
  const middle = Math.floor(kept.length / 2);
  return kept.length % 2 ? kept[middle] : (kept[middle - 1] + kept[middle]) / 2;
};

const number = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;

export async function GET(_request: Request, context: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await context.params;
  const symbol = ticker.toUpperCase();
  if (!TICKER_PATTERN.test(symbol)) {
    return NextResponse.json({ error: "That is not a usable exchange symbol." }, { status: 400 });
  }

  const table = await readUniverse();
  if (!table) {
    return NextResponse.json({ error: "The index has not been read yet." }, { status: 202, headers: { ...headers, "Cache-Control": "no-store" } });
  }

  const subject = table.rows.find((row) => row.ticker.toUpperCase() === symbol);
  const sector = typeof subject?.qs?.["Sector"] === "string" ? subject.qs["Sector"] as string : "";
  if (!subject || !sector) {
    /*
     * A company outside the index, or one the index carries without a sector,
     * gets no panel rather than a cohort picked on some other basis. "Peers"
     * that are not peers is the one answer worse than no answer.
     */
    return NextResponse.json({ error: `${symbol} is not in the index this compares against.` }, { status: 404, headers: { ...headers, "Cache-Control": "no-store" } });
  }

  const cohort = table.rows.filter((row) => row.qs?.["Sector"] === sector);
  const rows: QsRow[] = cohort.map((row) => {
    const quote = table.prices[row.ticker];
    return {
      ticker: row.ticker,
      values: { ...row.qs, ...qsValuationColumns(row.qsPrice, quote?.price ?? null, quote?.currency) },
    };
  });

  const scored = new Map((screen(qsTable(rows), {}).all as ScoredCompany[]).map((company) => [company.Ticker, company]));
  const named = new Map(cohort.map((row) => [row.ticker, row.name]));
  const peers: PeerRow[] = rows.map((row) => {
    const company = scored.get(row.ticker);
    return {
      ticker: row.ticker,
      name: named.get(row.ticker) ?? row.ticker,
      grade: company?.note ?? "NR",
      total: company?.total ?? null,
      marketCap: number(row.values["Market Cap"]),
      evEbit: number(row.values["EV/EBIT"]),
      evFcf: number(row.values["EV/FCF"]),
      fcfYield: number(row.values["FCF Yield"]),
    };
  }).sort((left, right) => (right.marketCap ?? -1) - (left.marketCap ?? -1));

  const answer: PeersAnswer = {
    sector,
    index: table.name,
    asOf: table.asOf,
    builtAt: table.builtAt,
    subject: symbol,
    peers,
    medians: {
      marketCap: median(peers.map((peer) => peer.marketCap)),
      evEbit: median(peers.map((peer) => peer.evEbit)),
      evFcf: median(peers.map((peer) => peer.evFcf)),
      fcfYield: median(peers.map((peer) => peer.fcfYield)),
    },
  };
  return new Response(JSON.stringify(answer), { headers });
}
