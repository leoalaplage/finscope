/**
 * The euro area's own yield curve, from the bank that publishes it.
 *
 * Yahoo carries US Treasury yields as tradeable symbols and carries nothing at
 * all for a Bund, a gilt or an OAT — every ticker that looks like one resolves
 * to something else or to nothing. The ECB publishes the euro-area curve
 * itself, once a business day, in a form a machine can read, so this is the
 * source rather than a second-hand quote of it.
 *
 * The series is the AAA-rated curve: a Svensson fit through the bonds of the
 * euro-area governments whose rating is triple A, which is what "the euro-area
 * risk-free rate" means when anybody says it. It is not the Bund, and it is
 * not called the Bund anywhere on this site.
 *
 * Once a business day, and published with about a day's lag. That is stated on
 * screen beside every figure taken from here rather than smoothed over: a
 * reading dated two days ago sitting unlabelled in a row of live ones is
 * exactly the silent substitution this application does not make.
 */

import type { MarketRange, MarketWindow } from "./intraday";

const BASE = "https://data-api.ecb.europa.eu/service/data/YC";

/**
 * How many readings each window is worth, in business days.
 *
 * One more than the window itself, because the last reading before a window
 * opened is what the window is measured from — the dashed line on the chart is
 * "where this stood a month ago", and a month ago is not the first point of
 * the month.
 *
 * A single day is absent on purpose. This curve is published once a day, so a
 * one-session line would be one point: the panel says so instead of drawing a
 * chart with nothing in it.
 */
const OBSERVATIONS: Partial<Record<MarketRange, number>> = {
  "5D": 5, "1M": 23, "6M": 131, "1Y": 262, "5Y": 1_305,
};

/**
 * Why a single session cannot be drawn, in the words the panel shows.
 *
 * A refusal rather than an error: nothing has gone wrong upstream, the series
 * simply does not exist at that resolution. Named here so the route can say it
 * before spending a request finding out.
 */
export const ECB_NO_INTRADAY = "The ECB publishes this curve once a day, so there is no line inside a single session. Choose a longer window.";

/** Whether this window has enough readings in it to be a line. */
export const ecbDraws = (range: MarketRange) => OBSERVATIONS[range] != null;

/** Noon UTC on a published date, which is a stamp rather than a claim about a time. */
const stamp = (date: string) => Math.floor(Date.parse(`${date}T12:00:00Z`) / 1_000);

export interface EcbObservation {
  date: string;
  value: number;
}

/**
 * The observations in a CSV answer, in the order the portal returned them.
 *
 * The columns are found by name rather than by position. `detail=dataonly`
 * already trims the answer from thirty-nine columns to ten, and a tenth column
 * added or removed upstream would silently shift a positional read onto the
 * wrong field — which is the failure that looks like data rather than like an
 * error.
 */
export function parseEcbCsv(text: string): EcbObservation[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const columns = lines[0].split(",");
  const when = columns.indexOf("TIME_PERIOD");
  const what = columns.indexOf("OBS_VALUE");
  if (when < 0 || what < 0) return [];

  const observations: EcbObservation[] = [];
  for (const line of lines.slice(1)) {
    const fields = line.split(",");
    const date = fields[when];
    // A published date with a blank value is a holiday, not a zero yield —
    // and `Number("")` is nought, which is how a blank becomes a figure.
    const raw = fields[what]?.trim();
    const value = Number(raw);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !raw || !Number.isFinite(value)) continue;
    observations.push({ date, value });
  }
  return observations.sort((a, b) => a.date.localeCompare(b.date));
}

async function readSeries(key: string, count: number): Promise<EcbObservation[]> {
  const response = await fetch(`${BASE}/${key}?format=csvdata&detail=dataonly&lastNObservations=${count}`, {
    headers: { Accept: "text/csv" },
  });
  if (!response.ok) throw new Error(`The ECB data portal returned ${response.status}.`);
  const observations = parseEcbCsv(await response.text());
  if (!observations.length) throw new Error("The ECB data portal returned no observations for this series.");
  return observations;
}

/**
 * The latest reading and the one before it, which is all a figure needs.
 *
 * Kept apart from the window below because the two answer different questions:
 * this one is the number in the strip and the day's move under it, and it must
 * work on the one range the window refuses.
 */
export async function fetchEcbLatest(key: string): Promise<{ rate: number; previous: number | null; date: string }> {
  const observations = await readSeries(key, 2);
  const last = observations.at(-1)!;
  return { rate: last.value, previous: observations.length > 1 ? observations[0].value : null, date: last.date };
}

/**
 * One series over a chosen window, in the shape the index panels already draw.
 *
 * Returning a `MarketWindow` rather than a shape of its own is what lets a euro
 * yield open in exactly the same panel as an oil price and an equity index. The
 * fields that only mean something for a traded instrument are answered
 * honestly: nothing here is open, because a published curve does not trade.
 */
export async function fetchEcbWindow(key: string, name: string, range: MarketRange): Promise<MarketWindow> {
  const wanted = OBSERVATIONS[range];
  if (!wanted) throw new Error(ECB_NO_INTRADAY);

  const observations = await readSeries(key, wanted + 1);
  // The oldest reading is the baseline and is not drawn; everything after it is
  // the window. A series shorter than asked for still draws, one point down.
  const baseline = observations.length > 1 ? observations[0].value : null;
  const drawn = observations.length > 1 ? observations.slice(1) : observations;
  const points = drawn.map((observation) => ({ time: stamp(observation.date), label: observation.date, close: observation.value }));
  const last = points.at(-1)?.close ?? null;
  const asOf = drawn.at(-1)?.date ?? null;

  return {
    symbol: key,
    name,
    // Nothing on the panel reads this, and a yield is not priced in a currency;
    // the denomination of the bonds behind the curve is the honest answer.
    currency: "EUR",
    timezone: "Europe/Frankfurt",
    range,
    points,
    baseline,
    last,
    change: last != null && baseline != null ? last - baseline : null,
    changePercent: last != null && baseline != null && baseline !== 0 ? (last - baseline) / baseline : null,
    open: false,
    asOf: asOf ? stamp(asOf) : null,
    sessionDate: asOf ?? "",
  };
}
