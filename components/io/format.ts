/**
 * How a figure is written on this site, and nowhere else is it decided.
 *
 * Two rules run through all of it. A number that is not known is written as an
 * em dash, never as a zero — the whole point of the engine underneath is that
 * it refuses to infer, and a page that prints 0 for "the filer does not tag
 * this" throws that away at the last step. And a negative carries a real minus
 * sign rather than a hyphen, because the two are different widths and a column
 * of figures set in a monospaced face is the one place that shows.
 */

export const ABSENT = "—";

const SYMBOLS: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", JPY: "¥", CHF: "CHF\u202f", CAD: "CA$", AUD: "A$" };

export function currencySymbol(currency: string | null | undefined) {
  if (!currency) return "";
  return SYMBOLS[currency] ?? `${currency}\u202f`;
}

const MINUS = "−";

function signed(text: string, negative: boolean) {
  return negative ? `${MINUS}${text}` : text;
}

/**
 * Three significant figures, scaled to the largest unit that fits.
 *
 * A balance sheet spans nine orders of magnitude — a share count in the
 * billions beside a dividend per share of a dollar and change — and writing
 * every one of them out in full makes a table a reader has to count digits in.
 */
export function compact(value: number | null | undefined, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return ABSENT;
  const size = Math.abs(value);
  if (size === 0) return "0";
  const units: Array<[number, string]> = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]];
  for (const [scale, suffix] of units) {
    if (size >= scale) {
      const scaled = size / scale;
      const places = scaled >= 100 ? 0 : scaled >= 10 ? decimals : decimals + 1;
      return signed(`${scaled.toFixed(places)}${suffix}`, value < 0);
    }
  }
  return signed(size >= 10 ? size.toFixed(0) : size.toFixed(2), value < 0);
}

export function money(value: number | null | undefined, currency: string | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return ABSENT;
  const body = compact(value);
  return body.startsWith(MINUS)
    ? `${MINUS}${currencySymbol(currency)}${body.slice(1)}`
    : `${currencySymbol(currency)}${body}`;
}

export function price(value: number | null | undefined, currency: string | null | undefined, places = 2): string {
  if (value == null || !Number.isFinite(value)) return ABSENT;
  const body = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: places, maximumFractionDigits: places });
  return signed(`${currencySymbol(currency)}${body}`, value < 0);
}

/** Decimal fractions in, percent out — the engine never stores a percentage. */
export function percent(value: number | null | undefined, places = 1): string {
  if (value == null || !Number.isFinite(value)) return ABSENT;
  return signed(`${(Math.abs(value) * 100).toFixed(places)}%`, value < 0);
}

export function delta(value: number | null | undefined, places = 2): string {
  if (value == null || !Number.isFinite(value)) return ABSENT;
  const body = `${(Math.abs(value) * 100).toFixed(places)}%`;
  return value < 0 ? `${MINUS}${body}` : `+${body}`;
}

export function ratio(value: number | null | undefined, places = 1): string {
  if (value == null || !Number.isFinite(value)) return ABSENT;
  return signed(`${Math.abs(value).toFixed(places)}×`, value < 0);
}

export function count(value: number | null | undefined): string {
  return compact(value);
}

export type Unit = "currency" | "shares" | "percent" | "perShare" | "ratio";

export function formatUnit(value: number | null | undefined, unit: Unit, currency: string | null | undefined): string {
  switch (unit) {
    case "currency": return money(value, currency);
    case "perShare": return price(value, currency);
    case "percent": return percent(value);
    case "ratio": return ratio(value, 2);
    case "shares": return count(value);
  }
}

/** Direction, as the sign it is. No hue on this site carries it. */
export function direction(value: number | null | undefined): "up" | "down" | "flat" {
  if (value == null || !Number.isFinite(value) || value === 0) return "flat";
  return value > 0 ? "up" : "down";
}

/**
 * Compound annual growth between the ends of a series.
 *
 * Refused where a sign change would make it meaningless: a company that went
 * from a loss to a profit has no growth rate, it has a turnaround, and writing
 * one is a claim the arithmetic cannot support.
 */
export function cagrOf(values: Array<number | null>, years: number): number | null {
  const known = values.map((value, index) => [index, value] as const).filter(([, value]) => value != null && Number.isFinite(value));
  if (known.length < 2) return null;
  const [endIndex, endValue] = known[known.length - 1] as [number, number];
  const target = known.find(([index]) => index >= endIndex - years);
  if (!target) return null;
  const [startIndex, startValue] = target as [number, number];
  const span = endIndex - startIndex;
  if (span < 1 || startValue <= 0 || endValue <= 0) return null;
  return (endValue / startValue) ** (1 / span) - 1;
}

/** CAGR from dated observations, so quarterly and market series share honest time. */
export function datedCagrOf(points: Array<{ date: string; value: number | null }>): number | null {
  const known = points.filter((point): point is { date: string; value: number } => point.value != null && Number.isFinite(point.value));
  if (known.length < 2) return null;
  const first = known[0];
  const last = known[known.length - 1];
  if (first.value <= 0 || last.value <= 0) return null;
  const elapsed = Date.parse(last.date) - Date.parse(first.date);
  const years = elapsed / (365.2425 * 86_400_000);
  /*
   * A window of about a year or more can state an annual rate; a fragment of
   * one cannot, because annualising it multiplies whatever happened in a
   * quarter by four and calls it a trend.
   *
   * The floor sits just under a year rather than at it. Five trailing
   * observations span a year to within a few days — a company's fiscal
   * quarters are not all ninety-one days long — and a strict `> 1` refused
   * every one of them, so the whole grid of figures lost its growth line the
   * moment the page was put on its own default range.
   */
  if (!Number.isFinite(years) || years < 0.9) return null;
  return (last.value / first.value) ** (1 / years) - 1;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return ABSENT;
  const [year, month, day] = iso.slice(0, 10).split("-");
  const index = Number(month) - 1;
  if (!MONTHS[index]) return iso;
  return `${day} ${MONTHS[index]} ${year}`;
}

export function yearOf(iso: string): string {
  return iso.slice(0, 4);
}

/**
 * The hour for something published today, the date for anything older.
 *
 * A news item is read for how recent it is, and "14:20" says that where a date
 * repeated eighteen times says nothing at all. Shared by the two news panels:
 * the wire under the market and a company's own newsroom read the same way.
 */
export function clock(iso: string | null | undefined): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const today = new Date();
  const sameDay = at.getUTCFullYear() === today.getUTCFullYear()
    && at.getUTCMonth() === today.getUTCMonth()
    && at.getUTCDate() === today.getUTCDate();
  return sameDay
    ? at.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
    : shortDate(iso);
}

/** Where the filing this figure came from can be read in full. */
export function edgarUrl(cik: string, accession: string): string | null {
  const digits = accession.replace(/\D/g, "");
  if (!cik || digits.length !== 18) return null;
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${digits}/`;
}
