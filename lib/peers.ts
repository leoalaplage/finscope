import type { ScreenerFeed } from "./screener-feed";

/**
 * A company's multiples against its sector's: where each sits among the
 * index's members of the same sector, cheapest first, beside the sector's
 * median and the largest peers. The figures are the screener's own
 * (lib/screener-feed.ts), struck the same way for every member.
 *
 * Pure.
 */
export type PeerMetricKey = "EV/EBIT" | "EV/FCF" | "FCF Yield" | "forwardPe" | "peg" | "P/E" | "P/B" | "P/TBV" | "ROE" | "Dividend Yield";

export interface PeerMetricSpec {
  key: PeerMetricKey;
  label: string;
  short: string;
  percent: boolean;
  /** Whether a higher figure is the cheaper one (a yield). */
  higherIsCheaper: boolean;
  /** A measure of return, not of price: ranked "higher than", not "cheaper than". */
  quality?: boolean;
}

/** An operating company's: on enterprise value and cash. */
export const PEER_METRICS: PeerMetricSpec[] = [
  { key: "EV/EBIT", label: "EV / EBIT", short: "EV / EBIT", percent: false, higherIsCheaper: false },
  { key: "EV/FCF", label: "EV / free cash flow", short: "EV / FCF", percent: false, higherIsCheaper: false },
  { key: "FCF Yield", label: "Free cash flow yield", short: "FCF yield", percent: true, higherIsCheaper: true },
  { key: "forwardPe", label: "Forward P / E", short: "Fwd P / E", percent: false, higherIsCheaper: false },
  { key: "peg", label: "PEG", short: "PEG", percent: false, higherIsCheaper: false },
];

/**
 * A lender's — a bank, a broker, an insurer: on earnings and book, because its
 * enterprise value and its free cash flow are its balance sheet moving and
 * are withheld everywhere on this site. Return on equity beside the price of
 * book, which it is what justifies.
 */
export const LENDER_PEER_METRICS: PeerMetricSpec[] = [
  { key: "P/E", label: "P / E, trailing", short: "P / E", percent: false, higherIsCheaper: false },
  { key: "forwardPe", label: "Forward P / E", short: "Fwd P / E", percent: false, higherIsCheaper: false },
  { key: "P/B", label: "Price / book", short: "P / B", percent: false, higherIsCheaper: false },
  { key: "P/TBV", label: "Price / tangible book", short: "P / TBV", percent: false, higherIsCheaper: false },
  { key: "ROE", label: "Return on equity", short: "ROE", percent: true, higherIsCheaper: true, quality: true },
  { key: "Dividend Yield", label: "Dividend yield", short: "Div. yield", percent: true, higherIsCheaper: true },
];

export interface PeerMetric {
  key: PeerMetricKey;
  label: string;
  percent: boolean;
  company: number | null;
  median: number | null;
  /** Share of the sector's members the company is cheaper than on this measure, 0 to 1. */
  cheaperThan: number | null;
  /** Members with a usable figure. */
  count: number;
}

export interface PeerTable {
  ticker: string;
  sector: string | null;
  /** Read as a lender, on earnings and book. */
  lender: boolean;
  members: number;
  /** The table the sector is drawn from: "US 1000", or "All US" for a company outside the thousand largest. */
  universe?: string;
  /** "largest" for the sector's biggest; "nearest" for the companies closest to this one in market value. */
  pick?: "largest" | "nearest";
  metrics: PeerMetric[];
  /** The largest members of the sector (or those nearest in size), the company among them. */
  peers: Array<{ ticker: string; name: string; marketCap: number | null; values: Partial<Record<PeerMetricKey, number | null>> }>;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
/** A multiple is a price paid for something positive; a negative one is a loss, not a cheap price. Returns and yields may be anything sane. */
const usable = (key: PeerMetricKey, value: unknown): value is number => finite(value) && (key === "FCF Yield" || key === "ROE" || key === "Dividend Yield" ? Math.abs(value) < 100 : value > 0 && value < 500);

export function peerTable(feed: Pick<ScreenerFeed, "rows"> & { name?: string }, ticker: string, pick: "largest" | "nearest" = "largest"): PeerTable | null {
  const symbol = ticker.toUpperCase();
  const company = feed.rows.find((row) => row.ticker.toUpperCase() === symbol);
  if (!company) return null;
  const sector = company.sector;
  const members = sector ? feed.rows.filter((row) => row.sector === sector) : [];
  // A lender has neither EV/EBIT nor free cash flow in the table, by design; it has book.
  const lender = !finite(company.values["EV/EBIT"]) && !finite(company.values["FCF Yield"]) && finite(company.values["P/B"]);
  const specs = lender ? LENDER_PEER_METRICS : PEER_METRICS;
  const metrics = specs.map((spec): PeerMetric => {
    const values = members.map((row) => row.values[spec.key]).filter((value): value is number => usable(spec.key, value)).sort((a, b) => a - b);
    const own = company.values[spec.key];
    const mine = usable(spec.key, own) ? own : null;
    const middle = Math.floor(values.length / 2);
    const median = values.length ? (values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2) : null;
    const others = values.length - 1;
    const cheaperThan = mine == null || others < 1 ? null
      : (spec.higherIsCheaper ? values.filter((value) => value < mine).length : values.filter((value) => value > mine).length) / others;
    return { key: spec.key, label: spec.label, percent: spec.percent, company: mine, median, cheaperThan, count: values.length };
  });
  const capOf = (row: ScreenerFeed["rows"][number]) => (finite(row.values["Market Cap"]) ? row.values["Market Cap"] as number : null);
  // A small company is shown beside the companies of its own size, not beside the sector's giants.
  const own = capOf(company);
  const distance = (row: ScreenerFeed["rows"][number]) => { const cap = capOf(row); return cap && own ? Math.abs(Math.log(cap / own)) : Infinity; };
  const ranked = pick === "nearest" && own
    ? [...members].sort((left, right) => distance(left) - distance(right)).slice(0, 12).sort((left, right) => (capOf(right) ?? 0) - (capOf(left) ?? 0))
    : [...members].sort((left, right) => (capOf(right) ?? 0) - (capOf(left) ?? 0)).slice(0, 12);
  const peers = ranked
    .map((row) => ({ ticker: row.ticker, name: row.name, marketCap: capOf(row), values: Object.fromEntries(specs.map((spec) => [spec.key, usable(spec.key, row.values[spec.key]) ? row.values[spec.key] as number : null])) }));
  if (!peers.some((peer) => peer.ticker.toUpperCase() === symbol)) {
    peers.push({ ticker: company.ticker, name: company.name, marketCap: capOf(company), values: Object.fromEntries(specs.map((spec) => [spec.key, usable(spec.key, company.values[spec.key]) ? company.values[spec.key] as number : null])) });
  }
  return { ticker: company.ticker, sector, lender, members: members.length, ...(feed.name ? { universe: feed.name } : {}), pick, metrics, peers };
}
