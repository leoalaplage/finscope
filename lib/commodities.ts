/**
 * The raw materials whose prices move everything else, and nothing beyond them.
 *
 * A market page that shows three equity indices and nothing else is showing one
 * asset class. What an oil major earns, what a miner earns, what a manufacturer
 * pays and what the inflation figure on this same page will read next month all
 * sit in these six lines, and none of them is visible in the S&P.
 *
 * Six, chosen the way the index list was chosen: the benchmark contract for
 * each thing rather than every contract that trades. Brent prices most of the
 * world's oil and West Texas prices North America's; the two disagree, and the
 * gap between them is itself a reading. Gold and silver are the store of value
 * and its high-beta cousin. Copper is the industrial bellwether — it is in
 * every building and every motor, which is why it moves before the surveys do.
 * Natural gas is the one that is regional rather than global, and the only one
 * here whose price a cold January can double.
 *
 * Front-month futures, which is what "the oil price" means when anybody says
 * it. A futures contract expires and the series rolls to the next one; the
 * continuous symbol handles that, and the page states which contract it is
 * reading so a roll is never mistaken for a move.
 */
export interface CommodityDefinition {
  /** How this application names it, and what its URL says. */
  id: string;
  /** Yahoo's continuous front-month symbol. */
  symbol: string;
  label: string;
  /** Energy or metal: the two groups the six fall into. */
  group: "energy" | "metal";
  /** What the quoted price is a price of, which is never obvious. */
  unit: string;
  /**
   * How finely this contract is quoted.
   *
   * A property of the quote, not of the size of the number. Guessing it from
   * the magnitude put copper at $6.520 a pound and gas at $2.84 — a trailing
   * nought on one and a missing digit on the other. Gas moves in tenths of a
   * cent and is quoted that way; everything else here is quoted to the cent,
   * whatever the contract's own tick is.
   */
  places: number;
}

export const COMMODITIES: CommodityDefinition[] = [
  { id: "BRENT", symbol: "BZ=F", label: "Brent crude", group: "energy", unit: "a barrel", places: 2 },
  { id: "WTI", symbol: "CL=F", label: "WTI crude", group: "energy", unit: "a barrel", places: 2 },
  { id: "GAS", symbol: "NG=F", label: "Natural gas", group: "energy", unit: "a million BTU", places: 3 },
  { id: "GOLD", symbol: "GC=F", label: "Gold", group: "metal", unit: "an ounce", places: 2 },
  { id: "SILVER", symbol: "SI=F", label: "Silver", group: "metal", unit: "an ounce", places: 2 },
  { id: "COPPER", symbol: "HG=F", label: "Copper", group: "metal", unit: "a pound", places: 2 },
];
