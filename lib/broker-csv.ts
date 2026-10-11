import type { Position } from "./portfolio";
import { newTransactionId, type Transaction } from "./transactions";

/**
 * A broker's export, read into trades or holdings.
 *
 * Every broker writes its own CSV, and none of them agree on a column name,
 * a date format, a sign convention or where the table starts. Rather than a
 * parser per broker, this finds the header row by what it says — a symbol, a
 * quantity, and a date or an action — maps each column by the names brokers
 * actually use, and reads each row the way a person would:
 *
 * - Interactive Brokers: "Trades,Header,…,Symbol,Date/Time,Quantity,T. Price,Comm/Fee", sells as negative quantities.
 * - Charles Schwab: "Date,Action,Symbol,Quantity,Price,Fees & Comm,Amount", dates like "10/03/2025 as of 10/01/2025".
 * - Fidelity: "Run Date,Action,Symbol,Quantity,Price ($),Commission ($),Fees ($)", actions like "YOU BOUGHT …".
 * - Robinhood: "Activity Date,Instrument,Trans Code,Quantity,Price,Amount", prices like "$1,234.56".
 * - Vanguard: "Trade Date,Transaction Type,Symbol,Shares,Share Price,Commission Fees".
 * - E*TRADE: "TransactionDate,TransactionType,Symbol,Quantity,Price,Commission".
 * - Degiro: "Date,Time,Product,ISIN,Reference exchange,Venue,Quantity,Price,,…" in English,
 *   French or German, sales as negative quantities and the currency in the unnamed column beside the price.
 * - Trade Republic and other ISIN exports: "Datum;Typ;Wertpapier;ISIN;Stück;Kurs;Betrag;Gebühr" and the like,
 *   with Kauf/Verkauf, Achat/Vente or Buy/Sell.
 * - Anything else with a date, a side or signed quantity, a symbol or an ISIN, a quantity and a price.
 *
 * An export without dates — a positions statement — becomes holdings, with
 * the cost per share where it says one. Rows that are not buys or sells
 * (dividends, transfers, interest) are left out and counted.
 *
 * Two things are finished by the caller, because they need the network: a
 * row named by ISIN carries the ISIN as its ticker until `applyIsins` maps it
 * to the US listing (lib/adapters/isin.ts), and a trade dealt in another
 * currency carries its currency until `convertCurrencies` prices it in
 * dollars at the rate of its own day.
 */

export interface ImportResult {
  kind: "trades" | "holdings" | "none";
  transactions: Transaction[];
  positions: Position[];
  /** The broker format it looked like, for the preview. */
  format: string;
  rows: number;
  skipped: Array<{ line: number; reason: string }>;
  /** ISINs standing in for tickers until they are mapped, with the name the file gives each. */
  isins: Array<{ isin: string; name: string | null }>;
  /** Trades dealt in a currency other than dollars, by transaction id, with the fee's currency where it differs. */
  currencies: Record<string, { price: string; fee?: string }>;
}

/* --- CSV ---------------------------------------------------------------- */

/** One delimited line into cells, honouring quotes and doubled quotes. */
export function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = ""; let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quoted) {
      if (char === "\"" && line[index + 1] === "\"") { cell += "\""; index++; }
      else if (char === "\"") quoted = false;
      else cell += char;
    } else if (char === "\"") quoted = true;
    else if (char === delimiter) { cells.push(cell.trim()); cell = ""; }
    else cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function delimiterOf(lines: string[]): string {
  const sample = lines.slice(0, 20).join("\n");
  const counts = [",", ";", "\t"].map((delimiter) => ({ delimiter, count: sample.split(delimiter).length }));
  return counts.sort((left, right) => right.count - left.count)[0].delimiter;
}

/* --- Values ------------------------------------------------------------- */

/** "$1,234.56", "(1,234.56)", "-12", "1.234,56" (with a decimal comma) → a number. */
export function parseNumber(text: string | undefined, decimalComma = false): number | null {
  if (text == null) return null;
  let value = text.trim().replace(/[$€£\s]/g, "").replace(/[A-Z]{3}$/i, "");
  if (!value || value === "-" || value === "--") return null;
  const negative = /^\(.*\)$/.test(value) || value.startsWith("-");
  value = value.replace(/[()]/g, "").replace(/^[-+]/, "");
  value = decimalComma ? value.replace(/\./g, "").replace(",", ".") : value.replace(/,/g, "");
  const number = Number(value);
  return Number.isFinite(number) ? (negative ? -number : number) : null;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const iso = (year: number, month: number, day: number) =>
  year > 1900 && month >= 1 && month <= 12 && day >= 1 && day <= 31 ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : null;

/**
 * A date as brokers write one. `dayFirst` settles "03/04/2025" for a file
 * whose other dates prove which way round it is written.
 */
export function parseDate(text: string | undefined, dayFirst = false): string | null {
  if (!text) return null;
  const value = text.trim().replace(/\s+as of.*$/i, "");
  let match = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (match) return iso(Number(match[1]), Number(match[2]), Number(match[3]));
  match = value.match(/^(\d{4})(\d{2})(\d{2})(?:[;,\s]|$)/);
  if (match) return iso(Number(match[1]), Number(match[2]), Number(match[3]));
  match = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (match) {
    const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
    const [first, second] = [Number(match[1]), Number(match[2])];
    const [month, day] = dayFirst || first > 12 ? [second, first] : [first, second];
    return iso(year, month, day);
  }
  match = value.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (match && MONTHS[match[1].toLowerCase()]) return iso(Number(match[3]), MONTHS[match[1].toLowerCase()], Number(match[2]));
  match = value.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s-](\d{4})/);
  if (match && MONTHS[match[2].toLowerCase()]) return iso(Number(match[3]), MONTHS[match[2].toLowerCase()], Number(match[1]));
  return null;
}

/* --- Columns ------------------------------------------------------------ */

/** A header without accents, case, spaces or punctuation: "Quantité" → "quantite", "Stück" → "stuck". */
const norm = (header: string) => header.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z/&]/g, "");

const COLUMNS: Record<string, string[]> = {
  date: ["tradedate", "date/time", "datetime", "rundate", "activitydate", "transactiondate", "date", "datum", "executiondate", "settlementdate", "processdate", "buchungstag", "handelstag"],
  action: ["action", "transactiontype", "transcode", "type", "typ", "side", "buy/sell", "activity", "sens", "art", "transaktionsart", "operation", "description"],
  symbol: ["symbol", "ticker", "instrument", "securitysymbol", "code", "stock", "tickersymbol"],
  isin: ["isin", "codeisin", "isincode"],
  name: ["product", "produit", "produkt", "wertpapier", "security", "securityname", "name", "titel", "bezeichnung", "libelle"],
  quantity: ["quantity", "qty", "shares", "units", "filledqty", "quantityfilled", "quantite", "stuck", "stueck", "anzahl", "anteile", "nombre", "aantal"],
  price: ["price", "tprice", "tradeprice", "shareprice", "executionprice", "avgprice", "averageprice", "priceper", "cours", "kurs", "preis", "prix", "prixunitaire", "koers"],
  fee: ["comm/fee", "fees&comm", "commission", "commissions", "fees", "fee", "commissionfees", "brokerage", "transactionand/orthird", "transactioncosts", "frais", "fraisdecourtage", "gebuhr", "gebuhren", "transaktionskosten", "kosten"],
  amount: ["amount", "netamount", "proceeds", "total", "value", "principal", "betrag", "montant", "montantnegocie", "wert", "gesamt"],
  currency: ["currency", "devise", "wahrung", "waehrung", "ccy"],
  costTotal: ["costbasis", "costbasistotal", "totalcost", "costbasis$"],
  costPer: ["averagecost", "avgcost", "costbasispershare", "costpershare", "unitcost", "averageprice", "prixderevientunitaire"],
};

/** The index of the first header matching a role, by exact name first, then by prefix. */
function columnOf(headers: string[], role: string, taken: Set<number>): number {
  const names = COLUMNS[role];
  const normalized = headers.map(norm);
  for (const name of names) {
    const index = normalized.findIndex((header, at) => !taken.has(at) && header === name);
    if (index >= 0) return index;
  }
  for (const name of names) {
    const index = normalized.findIndex((header, at) => !taken.has(at) && name.length >= 4 && header.startsWith(name));
    if (index >= 0) return index;
  }
  return -1;
}

function formatOf(headers: string[]): string {
  const joined = headers.map(norm).join(",");
  if (joined.includes("tprice") || joined.includes("comm/fee")) return "Interactive Brokers";
  if (joined.includes("fees&comm")) return "Charles Schwab";
  if (joined.includes("rundate")) return "Fidelity";
  if (joined.includes("transcode")) return "Robinhood";
  if (joined.includes("shareprice") && joined.includes("transactiontype")) return "Vanguard";
  if (joined.includes("transactiondate") && joined.includes("transactiontype")) return "E*TRADE";
  if (joined.includes("isin") && /venue|lieudexecution|ausfuhrungsort|referenceexchange|placeboursiere|referenzborse/.test(joined)) return "Degiro";
  if (joined.includes("isin")) return "Trade Republic / ISIN export";
  return "Generic CSV";
}

const TICKER = /^[A-Z][A-Z0-9.\-/]{0,9}$/;
const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const CURRENCY = /^[A-Z]{3}$/;

function sideOf(text: string | undefined): "buy" | "sell" | "other" | null {
  if (!text) return null;
  const value = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/\b(sell|sold|sale|sld|sl|verkauf|vente|vendre|verkoop)\b/.test(value) || value === "s") return "sell";
  if (/\b(buy|bought|purchase|purchased|reinvest|reinvestment|bot|by|kauf|achat|acheter|aankoop|sparplan|savings ?plan|savings_plan|plan d'investissement)\b/.test(value) || value === "b") return "buy";
  if (/dividend|interest|zinsen|transfer|deposit|einzahlung|auszahlung|withdraw|journal|fee|tax|steuer|split|merger|spinoff|cash|adjust|ach|wire|depot|interet|versement|retrait/.test(value)) return "other";
  return null;
}

/* --- The import ---------------------------------------------------------- */

export function importBrokerCsv(text: string): ImportResult {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length);
  const empty: ImportResult = { kind: "none", transactions: [], positions: [], format: "Unrecognised", rows: 0, skipped: [], isins: [], currencies: {} };
  if (!lines.length) return empty;
  const delimiter = delimiterOf(lines);
  const decimalComma = delimiter === ";";
  const cells = lines.map((line) => splitLine(line, delimiter));

  // The header: the first row that names a symbol or an ISIN, and a quantity.
  const headerAt = cells.findIndex((row) => {
    const taken = new Set<number>();
    return (columnOf(row, "symbol", taken) >= 0 || columnOf(row, "isin", taken) >= 0) && columnOf(row, "quantity", new Set()) >= 0;
  });
  if (headerAt < 0) return { ...empty, skipped: [{ line: 1, reason: "No header naming a symbol or an ISIN, and a quantity, was found." }] };
  const headers = cells[headerAt];
  const taken = new Set<number>();
  const column: Record<string, number> = {};
  for (const role of ["isin", "symbol", "quantity", "date", "action", "price", "fee", "amount", "currency", "name", "costTotal", "costPer"]) {
    column[role] = columnOf(headers, role, taken);
    if (column[role] >= 0) taken.add(column[role]);
  }
  // Interactive Brokers prefixes every row with its section; only that section's data rows count.
  const section = headers[1] === "Header" ? headers[0] : null;
  const body = cells.slice(headerAt + 1)
    .map((row, offset) => ({ row, line: headerAt + offset + 2 }))
    .filter(({ row }) => !section || (row[0] === section && row[1] === "Data"));
  const at = (row: string[], role: string) => (column[role] >= 0 ? row[column[role]] : undefined);
  /*
   * Degiro writes the currency in an unnamed column right after the price and
   * after the fee; elsewhere a currency column names it for the whole row.
   */
  const besideCurrency = (row: string[], role: string) => {
    const index = column[role];
    if (index < 0) return null;
    const next = (row[index + 1] ?? "").trim().toUpperCase();
    return !headers[index + 1]?.trim() && CURRENCY.test(next) ? next : null;
  };
  // Day-first if any date in the file can only be read that way, or if the
  // file is European by its punctuation (decimal commas, dotted dates) or by
  // naming its securities by ISIN.
  const dateText = (row: string[]) => at(row, "date") ?? "";
  const dayFirst = column.date >= 0 && (decimalComma || column.isin >= 0
    || body.some(({ row }) => /^\d{1,2}\.\d{1,2}\.\d{2,4}/.test(dateText(row)))
    || body.some(({ row }) => { const match = dateText(row).match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/); return match != null && Number(match[1]) > 12; }));

  const skipped: ImportResult["skipped"] = [];
  const isins = new Map<string, string | null>();
  const format = formatOf(headers);

  /** The ticker a row names, an ISIN standing in for one, or a reason it has neither. */
  const identify = (row: string[]): { ticker: string } | { reason: string } | null => {
    const symbol = (at(row, "symbol") ?? "").trim().toUpperCase().replace(/\s+.*$/, "");
    const isin = (at(row, "isin") ?? "").trim().toUpperCase();
    if (/^total/i.test(symbol)) return null;
    if (symbol && TICKER.test(symbol) && !ISIN.test(symbol)) return { ticker: symbol.replace("/", ".") };
    const code = ISIN.test(symbol) ? symbol : ISIN.test(isin) ? isin : null;
    if (code) { if (!isins.has(code)) isins.set(code, (at(row, "name") ?? "").trim() || null); return { ticker: code }; }
    if (!symbol && !isin) return null;
    return { reason: `"${symbol || isin}" is neither a ticker nor an ISIN` };
  };

  if (column.date >= 0) {
    const transactions: Transaction[] = [];
    const currencies: ImportResult["currencies"] = {};
    for (const { row, line } of body) {
      const who = identify(row);
      if (!who) continue;
      if ("reason" in who) { skipped.push({ line, reason: who.reason }); continue; }
      const label = (at(row, "name") ?? "").trim() || who.ticker;
      const date = parseDate(at(row, "date"), dayFirst);
      if (!date) { skipped.push({ line, reason: `${label}: no readable date` }); continue; }
      const quantity = parseNumber(at(row, "quantity"), decimalComma);
      const amount = parseNumber(at(row, "amount"), decimalComma);
      const side = sideOf(at(row, "action"));
      if (side === "other") { skipped.push({ line, reason: `${label}: ${at(row, "action")} — not a buy or a sale` }); continue; }
      // No side column: a negative quantity is a sale, as Interactive Brokers and Degiro write it.
      const kind: "buy" | "sell" | null = side ?? (quantity != null ? (quantity < 0 ? "sell" : "buy") : null);
      if (!kind || quantity == null || quantity === 0) { skipped.push({ line, reason: `${label}: no quantity or side` }); continue; }
      const shares = Math.abs(quantity);
      const fee = Math.abs(parseNumber(at(row, "fee"), decimalComma) ?? 0);
      let price = parseNumber(at(row, "price"), decimalComma);
      if ((price == null || price <= 0) && amount != null) price = Math.max(0, (Math.abs(amount) - (kind === "buy" ? fee : -fee)) / shares);
      if (price == null || !(price >= 0)) { skipped.push({ line, reason: `${label}: no price` }); continue; }
      const rowCurrency = (at(row, "currency") ?? "").trim().toUpperCase();
      const priceCurrency = besideCurrency(row, "price") ?? (CURRENCY.test(rowCurrency) ? rowCurrency : "USD");
      const feeCurrency = besideCurrency(row, "fee") ?? priceCurrency;
      const id = newTransactionId();
      transactions.push({ id, ticker: who.ticker, date, kind, shares, price: Math.abs(price), ...(fee ? { fee } : {}) });
      if (priceCurrency !== "USD" || (fee && feeCurrency !== "USD")) currencies[id] = { price: priceCurrency, ...(fee && feeCurrency !== priceCurrency ? { fee: feeCurrency } : {}) };
    }
    return {
      kind: transactions.length ? "trades" : "none", transactions, positions: [], format, rows: body.length, skipped,
      isins: [...isins].map(([isin, name]) => ({ isin, name })), currencies,
    };
  }

  // No dates: a statement of positions.
  const held = new Map<string, Position>();
  for (const { row, line } of body) {
    const raw = (at(row, "symbol") ?? "").trim().toUpperCase();
    if (/^(total|cash|pending|account)/i.test(raw)) continue;
    const who = identify(row);
    if (!who) continue;
    if ("reason" in who) { skipped.push({ line, reason: who.reason }); continue; }
    const shares = parseNumber(at(row, "quantity"), decimalComma);
    if (shares == null || shares <= 0) { skipped.push({ line, reason: `${who.ticker}: no positive quantity` }); continue; }
    const per = parseNumber(at(row, "costPer"), decimalComma);
    const totalCost = parseNumber(at(row, "costTotal"), decimalComma);
    const cost = per != null && per > 0 ? per : totalCost != null && totalCost > 0 ? totalCost / shares : null;
    const previous = held.get(who.ticker);
    held.set(who.ticker, previous
      ? { ticker: who.ticker, shares: previous.shares + shares, ...(cost != null && previous.cost != null ? { cost: (previous.cost * previous.shares + cost * shares) / (previous.shares + shares) } : {}) }
      : { ticker: who.ticker, shares, ...(cost != null ? { cost } : {}) });
  }
  const positions = [...held.values()];
  return { kind: positions.length ? "holdings" : "none", transactions: [], positions, format, rows: body.length, skipped, isins: [...isins].map(([isin, name]) => ({ isin, name })), currencies: {} };
}

/* --- Finishing: ISINs to tickers, other currencies to dollars ------------ */

/**
 * Every ISIN standing in for a ticker replaced by its US listing; a row whose
 * ISIN has none is moved to the skipped list with the reason.
 */
export function applyIsins(result: ImportResult, listings: Record<string, { ticker: string } | null | undefined>): ImportResult {
  if (!result.isins.length) return result;
  const names = new Map(result.isins.map((entry) => [entry.isin, entry.name]));
  const missing = new Set<string>();
  const map = (ticker: string) => (ISIN.test(ticker) ? listings[ticker]?.ticker ?? (missing.add(ticker), null) : ticker);
  const transactions = result.transactions.flatMap((entry) => { const ticker = map(entry.ticker); return ticker ? [{ ...entry, ticker }] : []; });
  const positions = result.positions.flatMap((entry) => { const ticker = map(entry.ticker); return ticker ? [{ ...entry, ticker }] : []; });
  const skipped = [...result.skipped, ...[...missing].map((isin) => ({ line: 0, reason: `${names.get(isin) ?? isin} (${isin}): no listing on a US exchange` }))];
  const kind = transactions.length ? "trades" : positions.length ? "holdings" : "none";
  return { ...result, kind: result.kind === "none" ? "none" : kind, transactions, positions, skipped };
}

/** Closes of a currency against the dollar: how many dollars one unit bought, by date. */
export type DollarRates = Record<string, Array<{ date: string; rate: number }>>;

/**
 * Trades dealt in euros (or pounds, or francs) priced in dollars at the close
 * of their own day — the rate the money actually crossed at, to within a
 * day's move. A trade in a currency with no rate is left out and listed.
 */
export function convertCurrencies(result: ImportResult, rates: DollarRates): ImportResult {
  const ids = Object.keys(result.currencies);
  if (!ids.length) return result;
  const rateOn = (currency: string, date: string) => {
    if (currency === "USD") return 1;
    let found: number | null = null;
    for (const point of rates[currency] ?? []) { if (point.date > date) break; found = point.rate; }
    return found;
  };
  const skipped = [...result.skipped];
  const transactions = result.transactions.flatMap((entry) => {
    const currency = result.currencies[entry.id];
    if (!currency) return [entry];
    const priceRate = rateOn(currency.price, entry.date);
    const feeRate = rateOn(currency.fee ?? currency.price, entry.date);
    if (priceRate == null) { skipped.push({ line: 0, reason: `${entry.ticker} on ${entry.date}: no ${currency.price}/USD rate for that day` }); return []; }
    return [{ ...entry, price: entry.price * priceRate, ...(entry.fee ? { fee: entry.fee * (feeRate ?? priceRate) } : {}) }];
  });
  return { ...result, transactions, skipped, kind: transactions.length ? result.kind : "none" };
}
