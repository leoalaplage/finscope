/**
 * SUM: the session in a few sentences, written from the numbers on HOME and
 * from nothing else — the averages or their futures, how many members rose,
 * the sectors at either end, the largest companies that moved most, the
 * Treasuries and the dollar, the releases out today against their consensus,
 * the results reported against theirs, and what the futures price for the
 * Fed. A sentence whose numbers are missing is left out rather than guessed.
 *
 * Pure, and in plain templates: the same numbers always read the same way.
 */

export type Phase = "pre" | "open" | "after" | "closed";

export interface SummaryInput {
  phase: Phase;
  /** Fractions: S&P 500, Nasdaq, Dow, in that order where present. */
  indices: Array<{ label: string; change: number | null }>;
  futures: Array<{ label: string; change: number | null }>;
  /** The S&P 500's members, their sector and the day's move as a fraction, their market value. */
  members: Array<{ ticker: string; sector: string; change: number | null; cap: number | null }>;
  rates: Array<{ id: string; last: number | null; change: number | null }>;
  releases: Array<{ name: string; actual: string; consensus: string | null; surprise: "above" | "below" | "inline" | null; equity: number | null }>;
  results: Array<{ ticker: string; surprise: number | null }>;
  fed: { date: string; hike: number; cut: number } | null;
  signals: { highs: number; lows: number } | null;
}

const MINUS = "−";
const pct = (value: number, places = 1) => `${value < 0 ? MINUS : "+"}${Math.abs(value * 100).toFixed(places)}%`;
const bp = (value: number) => `${value < 0 ? MINUS : "+"}${Math.abs(Math.round(value))} bp`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (date: string) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;
const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** How a move of the averages reads: under a fifth of a per cent is not a direction. */
function direction(change: number): string {
  if (Math.abs(change) < 0.002) return "little changed";
  if (Math.abs(change) >= 0.015) return change > 0 ? "sharply higher" : "sharply lower";
  return change > 0 ? "higher" : "lower";
}

export function sessionSummary(input: SummaryInput): string[] {
  const out: string[] = [];
  const priced = input.indices.filter((index): index is { label: string; change: number } => index.change != null);
  const futures = input.futures.filter((future): future is { label: string; change: number } => future.change != null);

  // The averages, or before the open their futures.
  if (input.phase === "pre" && futures.length) {
    out.push(`Before the open, futures point ${direction(futures[0].change)}: ${list(futures.slice(0, 3).map((future) => `${future.label} ${pct(future.change, 2)}`))}.`);
  } else if (priced.length) {
    const lead = { open: "Stocks are", after: "Stocks closed", closed: "In the last session stocks closed", pre: "Stocks closed" }[input.phase];
    out.push(`${lead} ${direction(priced[0].change)}: ${list(priced.slice(0, 3).map((index) => `the ${index.label} ${pct(index.change, 2)}`))}.`);
  }
  const yesterday = input.phase === "pre" ? " yesterday" : "";

  // Breadth, and the sectors at either end.
  const moved = input.members.filter((member): member is typeof member & { change: number } => member.change != null);
  if (moved.length >= 100) {
    const up = moved.filter((member) => member.change > 0).length;
    const share = up / moved.length;
    const tone = share >= 0.7 ? "broad gains" : share <= 0.3 ? "broad losses" : share >= 0.55 ? "more rising than falling" : share <= 0.45 ? "more falling than rising" : "an even split";
    const sectors = [...new Set(moved.map((member) => member.sector))].flatMap((sector) => {
      const middle = median(moved.filter((member) => member.sector === sector).map((member) => member.change));
      return middle == null || moved.filter((member) => member.sector === sector).length < 5 ? [] : [{ sector, middle }];
    }).sort((a, b) => b.middle - a.middle);
    const sectorLine = sectors.length >= 2 && sectors[0].middle - sectors.at(-1)!.middle >= 0.005
      ? ` ${sectors[0].sector} led (median ${pct(sectors[0].middle)}) and ${sectors.at(-1)!.sector} lagged (${pct(sectors.at(-1)!.middle)}).`
      : "";
    out.push(`Underneath, ${up} of ${moved.length} S&P 500 members rose${yesterday}: ${tone}.${sectorLine}`);

    // The largest companies that moved most: the top fifty by value, the two moves at either end.
    const largest = moved.filter((member) => member.cap != null).sort((a, b) => b.cap! - a.cap!).slice(0, 50);
    const big = [...largest].sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).filter((member) => Math.abs(member.change) >= 0.02).slice(0, 4);
    if (big.length) out.push(`Among the fifty largest, the big moves${yesterday}: ${list(big.map((member) => `${member.ticker} ${pct(member.change)}`))}.`);
  }

  // Treasuries and the dollar.
  const rate = (id: string) => input.rates.find((row) => row.id === id);
  const ten = rate("US10Y"), two = rate("US2Y"), curve = rate("2s10s"), dollar = rate("DXY");
  if (ten?.last != null && ten.change != null) {
    const move = Math.abs(ten.change) < 1.5 ? "steady" : ten.change < 0 ? "lower" : "higher";
    let line = `Treasury yields are ${move}: the 10-year at ${ten.last.toFixed(2)}% (${bp(ten.change)})`;
    if (two?.last != null && two.change != null) line += `, the 2-year at ${two.last.toFixed(2)}% (${bp(two.change)})`;
    if (curve?.last != null && curve.change != null && Math.abs(curve.change) >= 1.5) line += `; the curve ${curve.change > 0 ? "steepens" : "flattens"} to ${bp(curve.last)} 2s10s`;
    out.push(`${line}.`);
  }
  if (dollar?.last != null && dollar.change != null) {
    out.push(Math.abs(dollar.change) < 0.1 ? `The dollar index is flat at ${dollar.last.toFixed(2)}.` : `The dollar index ${dollar.change > 0 ? "rises" : "falls"} ${Math.abs(dollar.change).toFixed(2)}% to ${dollar.last.toFixed(2)}.`);
  }

  // Today's releases, against their consensus.
  for (const release of input.releases.slice(0, 3)) {
    const against = release.consensus ? `${release.surprise === "inline" ? "in line with" : "against"} ${release.consensus} expected` : "";
    const reaction = release.equity != null ? `; S&P futures moved ${pct(release.equity, 2)} in the half hour after` : "";
    const verdict = release.surprise === "above" ? " — above the consensus" : release.surprise === "below" ? " — below the consensus" : "";
    out.push(`${release.name} came in at ${release.actual}${against ? ` ${against}` : ""}${verdict}${reaction}.`);
  }

  // Results reported today.
  const reported = input.results.filter((result): result is { ticker: string; surprise: number } => result.surprise != null);
  if (reported.length) {
    const beats = reported.filter((result) => result.surprise > 0).length;
    const notable = [...reported].sort((a, b) => Math.abs(b.surprise) - Math.abs(a.surprise)).slice(0, 3);
    out.push(`Results: ${beats} of ${reported.length} reporting today beat the consensus on earnings per share; the widest gaps ${list(notable.map((result) => `${result.ticker} ${result.surprise > 0 ? "+" : MINUS}${Math.abs(result.surprise).toFixed(1)}%`))}.`);
  }

  if (input.signals && (input.signals.highs || input.signals.lows)) {
    const when = input.phase === "open" ? " (the last session's and today's)" : input.phase === "pre" ? " in the last session" : "";
    out.push(`${input.signals.highs} S&P 500 members set a new 52-week high and ${input.signals.lows} a new low${when}.`);
  }

  // The Fed, as the futures price its next decision.
  if (input.fed) {
    const { date, hike, cut } = input.fed;
    const odds = hike >= 0.05 ? `${Math.round(hike * 100)}% odds of a hike` : cut >= 0.05 ? `${Math.round(cut * 100)}% odds of a cut` : "no change all but certain";
    out.push(`For the Fed on ${day(date)}, futures price ${odds}.`);
  }
  return out;
}

/** The New York session a moment falls in: weekdays only; a holiday reads as the session that did not open. */
export function phaseAt(now: Date): Phase {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map((part) => [part.type, part.value]));
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return "closed";
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes < 9 * 60 + 30 ? "pre" : minutes < 16 * 60 ? "open" : "after";
}

/** The moment a New York wall-clock time falls on, whatever the reader's own zone. */
export function newYorkMoment(date: string, time: string): number {
  const guess = Date.parse(`${date}T${time}:00Z`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
  const shown = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`);
  return guess + (guess - shown);
}

/** "in 2h 05m", "in 4m", "now", "2h ago". */
export function countdown(at: number, now: number): string {
  const minutes = Math.round((at - now) / 60_000);
  if (Math.abs(minutes) < 1) return "now";
  const span = Math.abs(minutes);
  const text = span >= 60 ? `${Math.floor(span / 60)}h ${String(span % 60).padStart(2, "0")}m` : `${span}m`;
  return minutes > 0 ? `in ${text}` : `${text} ago`;
}
