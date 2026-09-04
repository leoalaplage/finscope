/**
 * What the search opens when the reader presses return.
 *
 * Kept out of the component so the order below is a thing that can be tested,
 * because getting it wrong is not a visible mistake — it is a page that opens
 * on a company which does not exist.
 */

export interface SymbolMatch { ticker: string }

/** Letters, digits, and the dot and dash classes exchanges use. */
const SYMBOL = /^[A-Z0-9][A-Z0-9.-]{0,11}$/;

/**
 * Intent, in the order a reader actually has it.
 *
 * An exact symbol among the results first: someone who typed MSFT has already
 * chosen. Then whatever the SEC registry answered, because someone who typed a
 * company name has no symbol to offer and the search does. The typed text is
 * the last resort, for the moment before the debounced lookup lands, or when
 * the lookup failed.
 *
 * That last clause used to be the second: any text shaped like a ticker beat
 * the search results. "APPLE" is shaped exactly like a ticker — five letters —
 * so every single-word company name went to `/s/APPLE` and was answered "No
 * SEC filer trades under APPLE", while AAPL sat in the results unused. Names
 * containing a space still worked, which is what made it hard to see.
 */
export function chooseSymbol(typed: string, matches: SymbolMatch[]): string | null {
  const needle = typed.trim().toUpperCase();
  if (!needle) return null;
  const exact = matches.find((match) => match.ticker.toUpperCase() === needle);
  const chosen = exact ?? matches[0] ?? (SYMBOL.test(needle) ? { ticker: needle } : null);
  return chosen ? chosen.ticker.toUpperCase() : null;
}
