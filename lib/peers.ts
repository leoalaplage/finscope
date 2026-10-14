import type { ScreenerFeed } from "./screener-feed";

/**
 * A company's multiples against its sector's: where each sits among the
 * index's members of the same sector, cheapest first, beside the sector's
 * median and the largest peers. The figures are the screener's own
 * (lib/screener-feed.ts), struck the same way for every member.
 *
 * Pure.
 */
export type PeerMetricKey = "EV/EBIT" | "EV/FCF" | "FCF Yield" | "forwardPe" | "peg";

export const PEER_METRICS: Array<{ key: PeerMetricKey; label: string; percent: boolean; /** Whether a higher figure is the cheaper one. */ higherIsCheaper: boolean }> = [
  { key: "EV/EBIT", label: "EV / EBIT", percent: false, higherIsCheaper: false },
  { key: "EV/FCF", label: "EV / free cash flow", percent: false, higherIsCheaper: false },
  { key: "FCF Yield", label: "Free cash flow yield", percent: true, higherIsCheaper: true },
  { key: "forwardPe", label: "Forward P / E", percent: false, higherIsCheaper: false },
  { key: "peg", label: "PEG", percent: false, higherIsCheaper: false },
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
  members: number;
  metrics: PeerMetric[];
  /** The largest members of the sector, the company among them. */
  peers: Array<{ ticker: string; name: string; marketCap: number | null; values: Partial<Record<PeerMetricKey, number | null>> }>;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
/** A multiple is a price paid for something positive; a negative one is a loss, not a cheap price. */
const usable = (key: PeerMetricKey, value: unknown): value is number => finite(value) && (key === "FCF Yield" ? Math.abs(value) < 50 : value > 0 && value < 500);

export function peerTable(feed: Pick<ScreenerFeed, "rows">, ticker: string): PeerTable | null {
  const symbol = ticker.toUpperCase();
  const company = feed.rows.find((row) => row.ticker.toUpperCase() === symbol);
  if (!company) return null;
  const sector = company.sector;
  const members = sector ? feed.rows.filter((row) => row.sector === sector) : [];
  const metrics = PEER_METRICS.map((spec): PeerMetric => {
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
  const peers = [...members].sort((left, right) => (capOf(right) ?? 0) - (capOf(left) ?? 0)).slice(0, 12)
    .map((row) => ({ ticker: row.ticker, name: row.name, marketCap: capOf(row), values: Object.fromEntries(PEER_METRICS.map((spec) => [spec.key, usable(spec.key, row.values[spec.key]) ? row.values[spec.key] as number : null])) }));
  if (!peers.some((peer) => peer.ticker.toUpperCase() === symbol)) {
    peers.push({ ticker: company.ticker, name: company.name, marketCap: capOf(company), values: Object.fromEntries(PEER_METRICS.map((spec) => [spec.key, usable(spec.key, company.values[spec.key]) ? company.values[spec.key] as number : null])) });
  }
  return { ticker: company.ticker, sector, members: members.length, metrics, peers };
}
