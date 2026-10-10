/**
 * The terminal's command line, as a grammar that can be tested.
 *
 * A reader types the way a terminal is typed: a security, then what to do with
 * it — `AAPL GP`, `MSFT US FA <GO>` — or a function on its own, which means the
 * security already on screen. Everything here is pure: the component decides
 * where to go, this decides what was meant.
 */

export type CompanyFunction = "DES" | "GP" | "FA" | "EE" | "VAL" | "HDS" | "INS" | "CN" | "DCF" | "COMP";
export type GlobalFunction = "HOME" | "MKT" | "SCRN" | "PORT" | "CHART" | "HELP";

export interface FunctionSpec<Code extends string> { code: Code; name: string }

/**
 * What can be done to one company, in the order the function bar shows them.
 *
 * DES opens the company itself; the others are panels on the same screen,
 * except DCF and COMP, which are screens of their own.
 */
export const COMPANY_FUNCTIONS: FunctionSpec<CompanyFunction>[] = [
  { code: "DES", name: "Description" },
  { code: "GP", name: "Price graph" },
  { code: "FA", name: "Financial analysis" },
  { code: "EE", name: "Earnings release" },
  { code: "VAL", name: "Valuation history" },
  { code: "HDS", name: "Institutional holders" },
  { code: "INS", name: "Insider dealing" },
  { code: "CN", name: "Company news" },
  { code: "DCF", name: "Discounted cash flow" },
  { code: "COMP", name: "Compare" },
];

export const GLOBAL_FUNCTIONS: FunctionSpec<GlobalFunction>[] = [
  { code: "HOME", name: "Launchpad" },
  { code: "MKT", name: "Market" },
  { code: "SCRN", name: "Screener" },
  { code: "PORT", name: "Portfolio" },
  { code: "CHART", name: "Chart workspace" },
  { code: "HELP", name: "Commands" },
];

/**
 * Other spellings a terminal user's fingers already know.
 *
 * Bloomberg's own mnemonics for the same screens, so `AAPL HP` or `EQS` does
 * what the reader expects instead of searching for a company called EQS.
 */
const ALIASES: Record<string, CompanyFunction | GlobalFunction> = {
  GIP: "GP", HP: "GP", G: "GP",
  FIN: "FA", FS: "FA",
  ERN: "EE", EARN: "EE",
  HDS: "HDS", HOLD: "HDS",
  NEWS: "CN", N: "CN",
  COMPARE: "COMP", RV: "COMP",
  MAIN: "HOME", LP: "HOME",
  MARKET: "MKT", WEI: "MKT", IMAP: "MKT",
  EQS: "SCRN", SCREEN: "SCRN",
  PRT: "PORT", PORTFOLIO: "PORT",
  GRAPH: "CHART",
  "?": "HELP",
};

/** Words a terminal user types between the security and the function. */
const NOISE = new Set(["US", "EQUITY", "EQ", "<GO>", "GO"]);

const SYMBOL = /^[A-Z0-9][A-Z0-9.-]{0,11}$/;

const COMPANY_CODES = new Set<string>(COMPANY_FUNCTIONS.map((spec) => spec.code));
const GLOBAL_CODES = new Set<string>(GLOBAL_FUNCTIONS.map((spec) => spec.code));

export type Command =
  | { kind: "company"; ticker: string; fn: CompanyFunction }
  /** CHART alone carries the security it should open on, when there is one. */
  | { kind: "global"; fn: GlobalFunction; ticker?: string }
  /** Text that is not a command: a company name, to be looked up. */
  | { kind: "search"; query: string }
  | { kind: "empty" }
  /** A company function with no company named and none on screen. */
  | { kind: "needs-ticker"; fn: CompanyFunction };

function canonical(token: string): string {
  return ALIASES[token] ?? token;
}

/**
 * What the reader meant.
 *
 * `current` is the security on screen, if there is one, so a function typed on
 * its own applies to it. A known function code wins over a ticker of the same
 * spelling only when it stands alone or leads: `GP` alone is the graph of the
 * company on screen, `GP AAPL` and `AAPL GP` are both Apple's graph.
 */
export function parseCommand(input: string, current: string | null = null): Command {
  const tokens = input.toUpperCase().trim().split(/\s+/).filter(Boolean).filter((token) => !NOISE.has(token));
  if (!tokens.length) return { kind: "empty" };

  const words = tokens.map(canonical);
  const [first, second] = words;

  if (tokens.length === 1) {
    if (first === "CHART" && current) return { kind: "global", fn: "CHART", ticker: current };
    if (GLOBAL_CODES.has(first)) return { kind: "global", fn: first as GlobalFunction };
    if (COMPANY_CODES.has(first)) {
      return current ? { kind: "company", ticker: current, fn: first as CompanyFunction } : { kind: "needs-ticker", fn: first as CompanyFunction };
    }
    if (SYMBOL.test(tokens[0])) return { kind: "company", ticker: tokens[0], fn: "DES" };
    return { kind: "search", query: input.trim() };
  }

  if (tokens.length === 2) {
    // The chart workspace takes a security either side of its own name.
    if (second === "CHART" && SYMBOL.test(tokens[0])) return { kind: "global", fn: "CHART", ticker: tokens[0] };
    if (first === "CHART" && SYMBOL.test(tokens[1])) return { kind: "global", fn: "CHART", ticker: tokens[1] };
    // Security first, the way it is written on every terminal.
    if (COMPANY_CODES.has(second) && SYMBOL.test(tokens[0])) {
      return { kind: "company", ticker: tokens[0], fn: second as CompanyFunction };
    }
    // Function first, for a reader who thinks in verbs.
    if (COMPANY_CODES.has(first) && SYMBOL.test(tokens[1])) {
      return { kind: "company", ticker: tokens[1], fn: first as CompanyFunction };
    }
  }

  // Anything longer, or two words that are not a security and a function, is a
  // company name: "BANK OF AMERICA", "COCA COLA".
  return { kind: "search", query: input.trim() };
}

/** The site's own pages for a function, while the terminal does not draw them yet. */
export function hrefFor(command: Command): string | null {
  switch (command.kind) {
    case "company": {
      const ticker = encodeURIComponent(command.ticker);
      if (command.fn === "DCF") return `/dcf?s=${ticker}`;
      if (command.fn === "COMP") return `/compare?s=${ticker}`;
      if (command.fn === "DES") return `/t/s/${ticker}`;
      return `/t/s/${ticker}#${command.fn.toLowerCase()}`;
    }
    case "global":
      switch (command.fn) {
        case "HOME": return "/t";
        case "MKT": return "/market";
        case "SCRN": return "/screener";
        case "PORT": return "/portfolio";
        case "CHART": return command.ticker ? `/t/chart?s=${encodeURIComponent(command.ticker)}` : "/t/chart";
        case "HELP": return null;
      }
      return null;
    default:
      return null;
  }
}

/**
 * Functions whose code starts with what has been typed so far.
 *
 * Used to suggest while the reader types the second word, so `AAPL G` offers
 * GP before the lookup has said anything.
 */
export function suggestFunctions(input: string, current: string | null): { code: string; name: string; command: string }[] {
  const tokens = input.toUpperCase().trim().split(/\s+/).filter(Boolean).filter((token) => !NOISE.has(token));
  const endsWithSpace = /\s$/.test(input);
  if (!tokens.length) return [];

  // "AAPL " or "AAPL G": offer the company's functions.
  if (SYMBOL.test(tokens[0]) && (tokens.length === 2 || (tokens.length === 1 && endsWithSpace))) {
    const partial = tokens.length === 2 ? tokens[1] : "";
    return COMPANY_FUNCTIONS
      .filter((spec) => spec.code.startsWith(partial))
      .map((spec) => ({ code: spec.code, name: spec.name, command: `${tokens[0]} ${spec.code}` }));
  }

  // A lone partial word: global functions, and company ones if a company is on screen.
  if (tokens.length === 1 && !endsWithSpace) {
    const partial = tokens[0];
    const globals = GLOBAL_FUNCTIONS.filter((spec) => spec.code.startsWith(partial))
      .map((spec) => ({ code: spec.code, name: spec.name, command: spec.code }));
    const local = current
      ? COMPANY_FUNCTIONS.filter((spec) => spec.code.startsWith(partial))
        .map((spec) => ({ code: spec.code, name: `${spec.name} · ${current}`, command: `${current} ${spec.code}` }))
      : [];
    return [...globals, ...local];
  }

  return [];
}
