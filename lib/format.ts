/**
 * One way to write a number, for the whole application.
 *
 * Ten components were building their own `Intl.NumberFormat` and six were
 * writing their own compact notation, which is why the same figure could read
 * `$3.67T` on one screen, `3671.2` on another and `3.7Md` on a third. A
 * financial interface is a set of numbers that have to be comparable at a
 * glance; they cannot be comparable if each screen rounds them differently.
 *
 * Every function here takes a value that may be missing and returns a string.
 * Nothing throws, nothing guesses, and an absent figure is always the same
 * character — the em dash — so a gap looks like a gap everywhere.
 */

/** What a missing number looks like. One character, everywhere. */
export const NO_VALUE = "—";

const usable = (value: number | null | undefined): value is number =>
  value != null && Number.isFinite(value);

const symbolFor = (currency: string) => currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : `${currency} `;

/**
 * Money at the scale a reader thinks in: thousands, millions, billions,
 * trillions — never fourteen digits.
 *
 * Three or four significant figures throughout — two decimals below ten, one
 * above a hundred — so a column reads `$3.67T`, `$24.35B`, `$331.8B`, `$356M`
 * and keeps roughly the same width without ever rounding away a figure the
 * reader came for.
 */
export function money(value: number | null | undefined, currency = "USD"): string {
  if (!usable(value)) return NO_VALUE;
  const sign = value < 0 ? "−" : "";
  const size = Math.abs(value);
  const symbol = symbolFor(currency);
  for (const [limit, suffix] of [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]] as const) {
    if (size >= limit) {
      const scaled = size / limit;
      return `${sign}${symbol}${scaled.toFixed(scaled >= 100 ? 1 : 2)}${suffix}`;
    }
  }
  return `${sign}${symbol}${size.toFixed(size >= 100 ? 0 : 2)}`;
}

/** A share price, a dividend: the figures read to the cent. */
export function perShare(value: number | null | undefined, currency = "USD"): string {
  if (!usable(value)) return NO_VALUE;
  const sign = value < 0 ? "−" : "";
  return `${sign}${symbolFor(currency)}${Math.abs(value).toFixed(2)}`;
}

/**
 * A rate, given as a fraction. One decimal until it reaches three digits: a
 * margin of 12.6% keeps the tenth that a reader is comparing, and a 340% return
 * does not need it.
 */
export function percent(value: number | null | undefined, options: { sign?: boolean } = {}): string {
  if (!usable(value)) return NO_VALUE;
  const scaled = value * 100;
  const size = Math.abs(scaled);
  const text = `${size.toFixed(size < 100 ? 1 : 0)}%`;
  /*
   * A move that rounds to nothing has no direction to report. "−0.0%" is a
   * sign attached to zero, and it reads as a fall on a day the price did not
   * move — the minus is the only thing on the line the eye catches.
   */
  if (Number.parseFloat(text) === 0) return options.sign ? `0.0%` : text;
  if (scaled < 0) return `−${text}`;
  return options.sign ? `+${text}` : text;
}

/** A change, which always carries its direction. */
export function change(value: number | null | undefined): string {
  return percent(value, { sign: true });
}

/** A difference between two rates belongs in points, not percent of a percent. */
export function points(value: number | null | undefined): string {
  if (!usable(value)) return NO_VALUE;
  const size = Math.abs(value * 100).toFixed(1);
  if (Number.parseFloat(size) === 0) return `${size} pp`;
  return `${value >= 0 ? "+" : "−"}${size} pp`;
}

/** A multiple of something: 24.3× earnings, ×2.18 over ten years. */
export function multiple(value: number | null | undefined, options: { leading?: boolean } = {}): string {
  if (!usable(value)) return NO_VALUE;
  return options.leading ? `×${value.toFixed(2)}` : `${value.toFixed(1)}×`;
}

/** A plain ratio, like debt to equity. */
export function ratio(value: number | null | undefined): string {
  return usable(value) ? value.toFixed(2) : NO_VALUE;
}

/** A count of shares, at the same scale as the money beside it. */
export function shares(value: number | null | undefined): string {
  if (!usable(value)) return NO_VALUE;
  const size = Math.abs(value);
  for (const [limit, suffix] of [[1e9, "B"], [1e6, "M"], [1e3, "K"]] as const) {
    if (size >= limit) {
      const scaled = size / limit;
      return `${scaled.toFixed(scaled >= 100 ? 0 : 1)}${suffix}`;
    }
  }
  return size.toFixed(0);
}

/** A date a reader recognises: 27 Sep 2025 rather than 2025-09-27. */
export function readableDate(value: string | null | undefined): string {
  if (!value) return NO_VALUE;
  const parsed = Date.parse(value.length <= 10 ? `${value}T00:00:00Z` : value);
  if (!Number.isFinite(parsed)) return NO_VALUE;
  // Composed rather than formatted whole: `en-GB` writes "Sept" and `en-US`
  // writes "Sep 27, 2025", and the columns here want "27 Sep 2025".
  const parts = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).formatToParts(parsed);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("day")} ${part("month")} ${part("year")}`;
}

/** Which way a figure leans, for the one colour rule the interface has. */
/*
 * Colour follows what was printed, not what was measured.
 *
 * A rate of −0.00018 prints as "0.0%" and used to print it in red: a day the
 * price did not move, coloured as a fall. Anything that rounds away at the one
 * decimal these formatters use is flat, which for a money amount means
 * anything under five hundredths of a cent — zero by any reading.
 */
const ROUNDS_TO_NOTHING = 5e-5;

export function tone(value: number | null | undefined): "positive" | "negative" | "flat" {
  if (!usable(value) || Math.abs(value) < ROUNDS_TO_NOTHING) return "flat";
  return value > 0 ? "positive" : "negative";
}
