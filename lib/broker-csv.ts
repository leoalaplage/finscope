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
 * - Anything else with a date, a side or signed quantity, a symbol, a quantity and a price.
 *
 * An export without dates — a positions statement — becomes holdings, with
 * the cost per share where it says one. Rows that are not buys or sells
 * (dividends, transfers, interest) are left out and counted, and so are rows
 * naming an ISIN rather than a ticker, which this cannot map to a US listing.
 */

export interface ImportResult {
  kind: "trades" | "holdings" | "none";
  transactions: Transaction[];
  positions: Position[];
  /** The broker format it looked like, for the preview. */
  format: string;
  rows: number;
  skipped: Array<{ line: number; reason: string }>;
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

const norm = (header: string) => header.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z/&]/g, "");

const COLUMNS: Record<string, string[]> = {
  date: ["tradedate", "date/time", "datetime", "rundate", "activitydate", "transactiondate", "date", "executiondate", "settlementdate", "processdate"],
  action: ["action", "transactiontype", "transcode", "type", "side", "buy/sell", "activity", "description"],
  symbol: ["symbol", "ticker", "instrument", "securitysymbol", "code", "stock"],
  quantity: ["quantity", "qty", "shares", "units", "filledqty", "quantityfilled"],
  price: ["price", "tprice", "tradeprice", "shareprice", "executionprice", "avgprice", "averageprice", "priceper"],
  fee: ["comm/fee", "fees&comm", "commission", "commissions", "fees", "fee", "commissionfees", "brokerage"],
  amount: ["amount", "netamount", "proceeds", "total", "value", "principal"],
  costTotal: ["costbasis", "costbasistotal", "totalcost", "costbasis$"],
  costPer: ["averagecost", "avgcost", "costbasispershare", "costpershare", "unitcost", "averageprice"],
  isin: ["isin"],
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
  return "Generic CSV";
}

const TICKER = /^[A-Z][A-Z0-9.\-/]{0,9}$/;
const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

function sideOf(text: string | undefined): "buy" | "sell" | "other" | null {
  if (!text) return null;
  const value = text.toLowerCase();
  if (/\b(sell|sold|sale|sld|sl)\b/.test(value) || value === "s") return "sell";
  if (/\b(buy|bought|purchase|purchased|reinvest|reinvestment|bot|by)\b/.test(value) || value === "b") return "buy";
  if (/dividend|interest|transfer|deposit|withdraw|journal|fee|tax|split|merger|spinoff|cash|adjust|ach|wire/.test(value)) return "other";
  return null;
}

/* --- The import ---------------------------------------------------------- */

export function importBrokerCsv(text: string): ImportResult {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length);
  const empty: ImportResult = { kind: "none", transactions: [], positions: [], format: "Unrecognised", rows: 0, skipped: [] };
  if (!lines.length) return empty;
  const delimiter = delimiterOf(lines);
  const decimalComma = delimiter === ";";
  const cells = lines.map((line) => splitLine(line, delimiter));

  // The header: the first row that names a symbol and a quantity.
  const headerAt = cells.findIndex((row) => {
    const taken = new Set<number>();
    return columnOf(row, "symbol", taken) >= 0 && columnOf(row, "quantity", taken) >= 0;
  });
  if (headerAt < 0) return { ...empty, skipped: [{ line: 1, reason: "No header naming a symbol and a quantity was found." }] };
  const headers = cells[headerAt];
  const taken = new Set<number>();
  const column: Record<string, number> = {};
  for (const role of ["symbol", "quantity", "date", "action", "price", "fee", "amount", "costTotal", "costPer", "isin"]) {
    column[role] = columnOf(headers, role, taken);
    if (column[role] >= 0) taken.add(column[role]);
  }
  // Interactive Brokers prefixes every row with its section; only that section's data rows count.
  const section = headers[1] === "Header" ? headers[0] : null;
  const body = cells.slice(headerAt + 1)
    .map((row, offset) => ({ row, line: headerAt + offset + 2 }))
    .filter(({ row }) => !section || (row[0] === section && row[1] === "Data"));
  const at = (row: string[], role: string) => (column[role] >= 0 ? row[column[role]] : undefined);
  // Day-first if any date in the file can only be read that way, or if the
  // file is European by its punctuation: decimal commas, or dates with dots.
  const dayFirst = column.date >= 0 && (decimalComma || body.some(({ row }) => /^\d{1,2}\.\d{1,2}\.\d{2,4}/.test(at(row, "date") ?? "")) || body.some(({ row }) => {
    const match = (at(row, "date") ?? "").match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/);
    return match != null && Number(match[1]) > 12;
  }));

  const skipped: ImportResult["skipped"] = [];
  const format = formatOf(headers);
  const dated = column.date >= 0;

  if (dated) {
    const transactions: Transaction[] = [];
    for (const { row, line } of body) {
      const rawSymbol = (at(row, "symbol") ?? "").trim().toUpperCase().replace(/\s+.*$/, "");
      if (!rawSymbol || /^total/i.test(rawSymbol)) continue;
      if (ISIN.test(rawSymbol) || (!rawSymbol && at(row, "isin"))) { skipped.push({ line, reason: `${rawSymbol || at(row, "isin")}: an ISIN, not a US ticker` }); continue; }
      if (!TICKER.test(rawSymbol)) { skipped.push({ line, reason: `"${rawSymbol}" is not a ticker` }); continue; }
      const date = parseDate(at(row, "date"), dayFirst);
      if (!date) { skipped.push({ line, reason: `${rawSymbol}: no readable date` }); continue; }
      const quantity = parseNumber(at(row, "quantity"), decimalComma);
      const amount = parseNumber(at(row, "amount"), decimalComma);
      const side = sideOf(at(row, "action"));
      if (side === "other") { skipped.push({ line, reason: `${rawSymbol}: ${at(row, "action")} — not a buy or a sale` }); continue; }
      // No side column: a negative quantity is a sale, as Interactive Brokers writes it.
      const kind: "buy" | "sell" | null = side ?? (quantity != null ? (quantity < 0 ? "sell" : "buy") : null);
      if (!kind || quantity == null || quantity === 0) { skipped.push({ line, reason: `${rawSymbol}: no quantity or side` }); continue; }
      const shares = Math.abs(quantity);
      const fee = Math.abs(parseNumber(at(row, "fee"), decimalComma) ?? 0);
      let price = parseNumber(at(row, "price"), decimalComma);
      if ((price == null || price <= 0) && amount != null) price = Math.max(0, (Math.abs(amount) - (kind === "buy" ? fee : -fee)) / shares);
      if (price == null || !(price >= 0)) { skipped.push({ line, reason: `${rawSymbol}: no price` }); continue; }
      transactions.push({ id: newTransactionId(), ticker: rawSymbol.replace("/", "."), date, kind, shares, price: Math.abs(price), ...(fee ? { fee } : {}) });
    }
    return { kind: transactions.length ? "trades" : "none", transactions, positions: [], format, rows: body.length, skipped };
  }

  // No dates: a statement of positions.
  const held = new Map<string, Position>();
  for (const { row, line } of body) {
    const rawSymbol = (at(row, "symbol") ?? "").trim().toUpperCase();
    if (!rawSymbol || /^(total|cash|pending|account)/i.test(rawSymbol)) continue;
    if (ISIN.test(rawSymbol)) { skipped.push({ line, reason: `${rawSymbol}: an ISIN, not a US ticker` }); continue; }
    if (!TICKER.test(rawSymbol)) { skipped.push({ line, reason: `"${rawSymbol}" is not a ticker` }); continue; }
    const shares = parseNumber(at(row, "quantity"), decimalComma);
    if (shares == null || shares <= 0) { skipped.push({ line, reason: `${rawSymbol}: no positive quantity` }); continue; }
    const per = parseNumber(at(row, "costPer"), decimalComma);
    const totalCost = parseNumber(at(row, "costTotal"), decimalComma);
    const cost = per != null && per > 0 ? per : totalCost != null && totalCost > 0 ? totalCost / shares : null;
    const ticker = rawSymbol.replace("/", ".");
    const previous = held.get(ticker);
    held.set(ticker, previous
      ? { ticker, shares: previous.shares + shares, ...(cost != null && previous.cost != null ? { cost: (previous.cost * previous.shares + cost * shares) / (previous.shares + shares) } : {}) }
      : { ticker, shares, ...(cost != null ? { cost } : {}) });
  }
  const positions = [...held.values()];
  return { kind: positions.length ? "holdings" : "none", transactions: [], positions, format, rows: body.length, skipped };
}
