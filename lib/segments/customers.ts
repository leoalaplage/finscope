import { memberName } from "./xbrl";

/**
 * Who a company sells to, as its own filings name them.
 *
 * The accounting rules make a company disclose every customer that brings in
 * a tenth or more of its revenue (ASC 280-10-50-42), and the XBRL instance tags
 * the disclosure against `MajorCustomersAxis`: the share of revenue, or of
 * receivables, as `ConcentrationRiskPercentage1`, and often the revenue itself.
 * Ball names Coca-Cola, AB InBev and Red Bull; American Tower names AT&T,
 * T-Mobile and Verizon; Nvidia writes "Customer A". All of it is read from the
 * same instance documents the segments are (lib/segments/source.ts).
 *
 * A member on that axis is not always a customer. Utilities file their
 * residential, commercial and industrial classes there; others a count ("ten
 * customers") or an unnamed one ("Customer A"). Each member is classified from
 * its label, and only a named one can be linked to another company — by its
 * name equalling a member of the index, never by resemblance (see
 * `matchCompany`).
 *
 * Pure: strings in, facts and customers out.
 */

export type CustomerBenchmark = "revenue" | "receivables";
/** "class" — residential, "other customers" — is recognised so it can be left out; no customer carries it. */
export type CustomerKind = "named" | "unnamed" | "group" | "class";

export interface CustomerFact {
  member: string;
  /** A share (0.12 for 12%) of the benchmark, or an amount of revenue. */
  measure: "share" | "revenue";
  benchmark: CustomerBenchmark;
  start: string | null;
  end: string;
  value: number;
  currency: string | null;
  accession: string;
  filed: string;
  form: string;
}

export interface CustomerPoint {
  end: string; share: number | null; revenue: number | null; accession: string;
  /** The share worked out from the revenue the filing gives and the company's revenue that year, not stated. */
  derived?: boolean;
}

export interface Customer {
  member: string;
  label: string;
  kind: CustomerKind;
  /** The index member the name is, where it is one. */
  ticker: string | null;
  /** Fiscal years, oldest first: the share of revenue the filing states, and the revenue where it states that too. */
  annual: CustomerPoint[];
  /** The share of receivables at each balance-sheet date stated, oldest first. */
  receivables: Array<{ end: string; share: number; accession: string }>;
}

const CUSTOMER_AXES = new Set(["srt:MajorCustomersAxis", "us-gaap:MajorCustomersAxis"]);
const TYPE_AXIS = "us-gaap:ConcentrationRiskByTypeAxis";
const BENCHMARK_AXIS = "us-gaap:ConcentrationRiskByBenchmarkAxis";
const CUSTOMER_TYPE = "us-gaap:CustomerConcentrationRiskMember";
/** What a share is a share of. Anything else — purchases, assets, a segment's revenue — is not read. */
const BENCHMARKS: Record<string, CustomerBenchmark> = {
  "us-gaap:SalesRevenueNetMember": "revenue",
  "us-gaap:RevenueFromContractWithCustomerMember": "revenue",
  "us-gaap:RevenueFromContractWithCustomerProductAndServiceBenchmarkMember": "revenue",
  "us-gaap:RevenueBenchmarkMember": "revenue",
  "us-gaap:SalesRevenueGoodsNetMember": "revenue",
  "us-gaap:SalesRevenueServicesNetMember": "revenue",
  "us-gaap:AccountsReceivableMember": "receivables",
  "us-gaap:AccountsNotesAndLoansReceivableNetCurrentMember": "receivables",
};
const REVENUE = new Set([
  "us-gaap:Revenues",
  "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
  "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax",
  "us-gaap:SalesRevenueNet",
]);

interface CustomerContext { member: string; benchmark: CustomerBenchmark | null; typed: boolean; start: string | null; end: string | null }

/** Contexts on the customer axis and nothing else but the concentration's own type and benchmark. */
function customerContexts(xml: string): Map<string, CustomerContext> {
  const out = new Map<string, CustomerContext>();
  for (const match of xml.matchAll(/<(?:xbrli:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:xbrli:)?context>/g)) {
    const body = match[2];
    if (!/MajorCustomersAxis/.test(body) || /<xbrldi:typedMember\b/.test(body)) continue;
    let member: string | null = null;
    let benchmark: CustomerBenchmark | null = null;
    let typed = false;
    let other = false;
    for (const [, dimension, value] of body.matchAll(/<xbrldi:explicitMember\b[^>]*dimension="([^"]+)"[^>]*>\s*([^<\s]+)\s*<\/xbrldi:explicitMember>/g)) {
      if (CUSTOMER_AXES.has(dimension)) member = value;
      else if (dimension === TYPE_AXIS) { if (value === CUSTOMER_TYPE) typed = true; else other = true; }
      else if (dimension === BENCHMARK_AXIS) { benchmark = BENCHMARKS[value] ?? null; if (!benchmark) other = true; }
      // A customer's share of one segment, one product or one subsidiary is not its share of the company.
      else other = true;
    }
    if (!member || other) continue;
    const start = body.match(/<(?:xbrli:)?startDate>\s*([^<\s]+)\s*</)?.[1] ?? null;
    const end = body.match(/<(?:xbrli:)?(?:endDate|instant)>\s*([^<\s]+)\s*</)?.[1] ?? null;
    out.set(match[1], { member, benchmark, typed, start, end });
  }
  return out;
}

export function parseCustomerFacts(xml: string, filing: { accession: string; filed: string; form: string }): CustomerFact[] {
  const contexts = customerContexts(xml);
  if (!contexts.size) return [];
  const units = new Map<string, string>();
  for (const match of xml.matchAll(/<(?:xbrli:)?unit\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:xbrli:)?unit>/g)) {
    const measure = match[2].match(/<(?:xbrli:)?measure>\s*(?:iso4217:)?([A-Za-z]{3,4})\s*</);
    if (measure) units.set(match[1], measure[1]);
  }
  const facts: CustomerFact[] = [];
  for (const match of xml.matchAll(/<(us-gaap:[A-Za-z0-9]+)\b([^>]*)>([^<]+)<\/\1>/g)) {
    const concept = match[1];
    const share = concept === "us-gaap:ConcentrationRiskPercentage1";
    if (!share && !REVENUE.has(concept)) continue;
    const ref = match[2].match(/contextRef="([^"]+)"/)?.[1];
    const where = ref ? contexts.get(ref) : undefined;
    if (!where?.end) continue;
    const value = Number(match[3].trim());
    if (!Number.isFinite(value) || value < 0) continue;
    if (share) {
      // A share must say it is a customer's, and of what; "pure" between 0 and 1.
      if (!where.typed || !where.benchmark || value > 1) continue;
      facts.push({ member: where.member, measure: "share", benchmark: where.benchmark, start: where.start, end: where.end, value, currency: null, ...filing });
    } else {
      const unit = match[2].match(/unitRef="([^"]+)"/)?.[1];
      const currency = unit ? units.get(unit) ?? null : null;
      if (!currency || currency.toLowerCase() === "pure" || !where.start) continue;
      facts.push({ member: where.member, measure: "revenue", benchmark: "revenue", start: where.start, end: where.end, value, currency, ...filing });
    }
  }
  return facts;
}

const CARDINALS = new Set(["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "fifteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred"]);
const ORDINALS = new Set(["first", "second", "third", "fourth", "fifth", "sixth"]);
/** Who a share is held by, when the filing does not say who. */
const PARTIES = new Set([
  "customer", "customers", "client", "clients", "distributor", "distributors", "reseller", "resellers", "wholesaler", "wholesalers",
  "retailer", "retailers", "partner", "partners", "oem", "oems", "licensee", "licensees", "tenant", "tenants", "purchaser", "purchasers",
  "counterparty", "counterparties", "payor", "payors", "payer", "payers", "buyer", "buyers", "dealer", "dealers", "bottler", "bottlers",
  "company", "companies", "manufacturer", "manufacturers", "provider", "providers", "operator", "operators", "carrier", "carriers",
]);
/** Words that only rank or describe the party without naming it: "major customer one", "second largest customer", "one holding company". */
const FILLER = new Set(["major", "largest", "large", "significant", "top", "single", "another", "unidentified", "undisclosed", "unnamed", "individual", "number", "holding", "outsourced", "channel", "global", "end"]);
/** What a label says customers are, when it describes them rather than names one. */
const CLASS_WORDS = new Set([
  "residential", "commercial", "industrial", "municipal", "municipalities", "public", "wholesale", "retail", "transmission", "irrigation",
  "agriculture", "agricultural", "individuals", "institutions", "businesses", "consumers", "users", "accounts", "segment", "segments",
  "channels", "market", "markets", "sales", "revenue", "revenues", "receivables", "direct", "indirect", "recurring", "nonrecurring",
  "technology", "education", "healthcare", "government", "governmental", "academic", "pharmaceutical", "pharma", "biologics", "generics",
  "manufacturing", "construction", "portfolios", "affiliated", "unaffiliated", "percentage", "steam", "diy", "professional",
]);
const LEADING_CLASS = new Set(["no", "other", "non", "all", "total", "intersegment", "external", "internal", "international", "domestic"]);

/** Lower-case words, digits apart from letters: "Top10Customers" → top 10 customers, "Customer1" → customer 1. */
function labelWords(label: string): string[] {
  return label.replace(/([a-z])([A-Z0-9])/g, "$1 $2").replace(/([0-9])([A-Za-z])/g, "$1 $2").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
}

/** The United States government named as a customer, under its usual spellings. */
const US_GOVERNMENT = /^(?:the\s+)?(?:u\.?\s?s\.?|united\s+states|us)\s*(?:federal\s+)?government\b/i;
export const isUsGovernment = (label: string) => US_GOVERNMENT.test(label.replace(/\s+/g, " ").trim());

/**
 * What a member on the customer axis is, from its label.
 *
 * Unnamed and group are labels made only of a party ("customer",
 * "distributor"), a rank, a count and a letter or number. A number before the
 * party counts ("Three customers" is a group); after it, it names ("Customer
 * Three" is one customer). A class describes customers ("Manufacturing
 * customers", "Residential", "Other"). Named is what is left — and the US
 * government, which is a customer and not a class of one — so a new pattern of
 * anonymity shows up as a name that links to nothing rather than as a customer
 * silently dropped.
 */
export function customerKind(label: string): CustomerKind {
  if (isUsGovernment(label)) return "named";
  const words = labelWords(label);
  if (!words.length) return "class";
  const counting = (word: string) => CARDINALS.has(word) || /^\d+$/.test(word);
  const partyAt = words.findIndex((word) => PARTIES.has(word));
  const rest = words.filter((word) => !PARTIES.has(word) && !FILLER.has(word) && !counting(word) && !ORDINALS.has(word) && !/^[a-z]$/.test(word) && !/^[ivx]+$/.test(word));
  if (partyAt >= 0 && !rest.length) {
    const plural = words.some((word) => PARTIES.has(word) && /(?:s|ies)$/.test(word));
    const quantity = words.slice(0, partyAt).filter(counting);
    const several = quantity.some((word) => word !== "one" && word !== "1");
    return plural || several ? "group" : "unnamed";
  }
  if (LEADING_CLASS.has(words[0])) return "class";
  // "Three largest US wholesale customers": counted, so several customers, whatever kind they are.
  const leading = words.slice(0, Math.max(partyAt, 0)).find(counting);
  if (partyAt >= 0 && leading && leading !== "one" && leading !== "1" && /(?:s|ies)$/.test(words[partyAt])) return "group";
  if (partyAt >= 0 && /^(?:customer|client)/.test(words[partyAt])) return "class";
  // A word or two of description ("Residential", "Wholesale municipal"); a longer label with such a word in it is a name ("Taiwan Semiconductor Manufacturing").
  if (words.length <= 2 && rest.some((word) => CLASS_WORDS.has(word))) return "class";
  return "named";
}

/** Words after a company's name that keep it the same company: "Verizon Wireless", "Amazon.com Services", "Walmart and its subsidiaries". */
const SAME_COMPANY = new Set([
  "inc", "incorporated", "corp", "corporation", "co", "company", "companies", "ltd", "limited", "plc", "llc", "lp", "llp", "sa", "ag", "nv", "se", "spa",
  "and", "its", "the", "subsidiaries", "subsidiary", "affiliates", "affiliated", "entities", "group", "holdings", "holding",
  "wireless", "mobility", "services", "service", "web", "com", "usa", "us", "america", "americas", "north", "international", "global", "worldwide",
]);

/** Lower case, "&" as "and", no punctuation, no "the", no trailing "(The)". */
export function normalName(name: string): string[] {
  return name.toLowerCase()
    .replace(/\(the\)/g, " ")
    .replace(/&/g, " and ")
    .replace(/\.com\b/g, " com")
    .replace(/[^a-z0-9]+/g, " ")
    .trim().split(" ")
    .filter((word, index) => word && !(index === 0 && word === "the"));
}

const SUFFIXES = new Set(["inc", "incorporated", "corp", "corporation", "co", "company", "companies", "ltd", "limited", "plc", "llc", "lp", "sa", "ag", "nv", "class", "a", "b", "c"]);

/**
 * A company's name without the words that do not tell it apart: "Coca-Cola
 * Company (The)" → coca cola, "T-Mobile US, Inc." → t mobile. Corporate
 * suffixes go down to one word; "group", "US", "holdings" and the like only
 * while two words remain, so American International Group stays American
 * International and never becomes "American".
 */
function coreName(name: string): string[] {
  const words = normalName(name);
  while (words.length > 1 && SUFFIXES.has(words.at(-1)!)) words.pop();
  while (words.length > 2 && SAME_COMPANY.has(words.at(-1)!)) words.pop();
  return words;
}

/** The label is the name, or the name and words that keep it the same company; or the same letters written apart ("Wal-Mart", "Walmart"). */
function names(label: string[], core: string[]): boolean {
  if (!core.length) return false;
  if (core.length <= label.length && core.every((word, index) => label[index] === word) && label.slice(core.length).every((word) => SAME_COMPANY.has(word))) return true;
  const trimmed = [...label];
  while (trimmed.length > 1 && SAME_COMPANY.has(trimmed.at(-1)!)) trimmed.pop();
  return trimmed.join("") === core.join("");
}

export interface KnownCompany { ticker: string; name: string; aliases?: string[] }

/**
 * The index member a customer's label names, or null.
 *
 * Matched against the name the index carries and every name the member has
 * filed under (lib/universe-names.ts). The label must be one of those names,
 * or one followed only by words that leave it the same company —
 * subsidiaries, "wireless", "services", corporate suffixes. "Southern
 * California Edison" is not Southern Company and "General Dynamics" is not
 * General Motors: nothing is matched on part of a name or on resemblance. A
 * label two companies could be links to neither.
 */
export function matchCompany(label: string, companies: KnownCompany[]): string | null {
  const words = normalName(label);
  const found = companies.filter((company) => [company.name, ...(company.aliases ?? [])].some((name) => names(words, coreName(name))));
  // Share classes are one company: Alphabet A and C, Fox A and B.
  const issuers = new Set(found.map((company) => company.name.replace(/\s*\(Class [A-Z]\)\s*$/i, "")));
  return issuers.size === 1 ? found.map((company) => company.ticker).sort()[0] : null;
}

const YEAR_MS = 365.25 * 86_400_000;
const yearLong = (start: string | null, end: string) => start != null && Math.abs(Date.parse(end) - Date.parse(start) - YEAR_MS) < 20 * 86_400_000;

/**
 * Facts into customers: each member's share of revenue a fiscal year, the
 * latest filing's figure for a year stated twice, and its share of
 * receivables at each balance-sheet date. Newest first, then largest.
 *
 * A filing that gives only the revenue has its share worked out against the
 * company's revenue for the same year (`totals`, the consolidated figure the
 * segments read), and says so. A member that only ever carries revenue — no
 * concentration stated — is kept only when it is a company of the index or the
 * US government: utilities' customer classes and Comfort Systems' markets sit
 * on the same axis, and a share nobody called a concentration is not one.
 */
export function buildCustomers(facts: CustomerFact[], labels: Map<string, string>, companies: KnownCompany[], options: { self?: string; totals?: Map<string, number> } = {}): Customer[] {
  /*
   * One customer, however many members it was filed under: Ball's Coca-Cola
   * bottlers are one element in one year and another the next. The same index
   * member, or the same name once written plainly, is the same customer; the
   * newest filing's member and words name it.
   */
  const who = new Map<string, { label: string; kind: CustomerKind; ticker: string | null }>();
  for (const member of new Set(facts.map((fact) => fact.member))) {
    const label = memberName(member, labels);
    const kind = customerKind(label);
    const matched = kind === "named" ? matchCompany(label, companies) : null;
    who.set(member, { label, kind, ticker: matched === options.self ? null : matched });
  }
  const groups = new Map<string, CustomerFact[]>();
  for (const fact of facts) {
    const { label, kind, ticker } = who.get(fact.member)!;
    // A class of customers is a cut of revenue, not a counterparty.
    if (kind === "class") continue;
    const key = ticker ? `ticker:${ticker}` : `${kind}:${normalName(label).join(" ")}`;
    groups.set(key, [...(groups.get(key) ?? []), fact]);
  }
  const customers: Customer[] = [];
  for (const list of groups.values()) {
    const member = [...list].sort((left, right) => right.filed.localeCompare(left.filed))[0].member;
    const { label, kind, ticker } = who.get(member)!;
    const latest = (items: CustomerFact[]) => [...items].sort((left, right) => right.filed.localeCompare(left.filed))[0];
    const years = new Map<string, { share: CustomerFact | null; revenue: CustomerFact | null }>();
    for (const fact of list) {
      if (fact.benchmark !== "revenue" || !yearLong(fact.start, fact.end)) continue;
      const slot = years.get(fact.end) ?? { share: null, revenue: null };
      if (fact.measure === "share") slot.share = slot.share ? latest([slot.share, fact]) : fact;
      else slot.revenue = slot.revenue ? latest([slot.revenue, fact]) : fact;
      years.set(fact.end, slot);
    }
    const annual: CustomerPoint[] = [...years.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([end, slot]) => {
      const total = options.totals?.get(end);
      const worked = slot.share == null && slot.revenue && total && total > 0 && slot.revenue.value <= total ? slot.revenue.value / total : null;
      return {
        end, share: slot.share?.value ?? worked, revenue: slot.revenue?.value ?? null,
        accession: (slot.share ?? slot.revenue)!.accession,
        ...(worked != null ? { derived: true } : {}),
      };
    });
    const balances = new Map<string, CustomerFact>();
    for (const fact of list) {
      if (fact.benchmark !== "receivables" || fact.measure !== "share") continue;
      const held = balances.get(fact.end);
      balances.set(fact.end, held ? latest([held, fact]) : fact);
    }
    const receivables = [...balances.values()].sort((left, right) => left.end.localeCompare(right.end)).map((fact) => ({ end: fact.end, share: fact.value, accession: fact.accession }));
    if (!annual.some((point) => point.share != null || point.revenue != null) && !receivables.length) continue;
    const stated = list.some((fact) => fact.measure === "share");
    if (!stated && !ticker && !isUsGovernment(label)) continue;
    customers.push({ member, label, kind, ticker, annual, receivables });
  }
  const weight = (customer: Customer) => customer.annual.at(-1)?.share ?? customer.receivables.at(-1)?.share ?? 0;
  const lastYear = (customer: Customer) => customer.annual.at(-1)?.end ?? customer.receivables.at(-1)?.end ?? "";
  return customers.sort((left, right) => lastYear(right).localeCompare(lastYear(left)) || weight(right) - weight(left));
}
