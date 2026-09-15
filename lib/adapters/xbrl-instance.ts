/**
 * The figures in one filing, read from the filing itself.
 *
 * SEC Company Facts is the feed every figure on this site comes from, and it
 * can run weeks behind the filings. The daily audit found it: Coca-Cola filed
 * its June quarter on 29 July and on 15 September Company Facts still ended
 * at April — as it did for Visa, S&P Global, HCA and some thirty more of the
 * index. The report was public; the site simply could not see it.
 *
 * Every report carries an XBRL instance beside the document — for Coca-Cola's
 * June quarter, `ko-20260703_htm.xml` — and that instance is the very data
 * Company Facts is compiled from. This reads it into the shape Company Facts
 * serves, so the normalizer downstream cannot tell the two apart and applies
 * every one of its rules unchanged.
 *
 * Only facts on a plain context — the company as a whole, over a period or at
 * a date — are read. A context with a segment is a slice of the company (one
 * share class, one business line), and Company Facts leaves those out too.
 */

export interface FilingFact {
  start?: string;
  end: string;
  val: number;
  accn: string;
  fy: number | null;
  fp: string | null;
  form: string;
  filed: string;
}

export type FactTree = Record<string, Record<string, { units: Record<string, FilingFact[]> }>>;

/** The taxonomies this application reads; a company's own extension namespace is not among them. */
const READ = "us-gaap|dei|ifrs-full|srt";
const PREFIX = "(?:[\\w-]+:)?";

export function parseXbrlInstance(xml: string, filing: { accession: string; form: string; filed: string }, namespaces = READ): FactTree {
  const contexts = new Map<string, { start?: string; end: string }>();
  for (const match of xml.matchAll(new RegExp(`<${PREFIX}context\\b[^>]*\\bid="([^"]+)"[^>]*>([\\s\\S]*?)</${PREFIX}context>`, "g"))) {
    const body = match[2];
    if (new RegExp(`<${PREFIX}(segment|scenario)\\b`).test(body)) continue;
    const date = (tag: string) => body.match(new RegExp(`<${PREFIX}${tag}>\\s*(\\d{4}-\\d{2}-\\d{2})`))?.[1];
    const instant = date("instant");
    const start = date("startDate");
    const end = date("endDate");
    if (instant) contexts.set(match[1], { end: instant });
    else if (start && end) contexts.set(match[1], { start, end });
  }

  const units = new Map<string, string>();
  for (const match of xml.matchAll(new RegExp(`<${PREFIX}unit\\b[^>]*\\bid="([^"]+)"[^>]*>([\\s\\S]*?)</${PREFIX}unit>`, "g"))) {
    const measures = [...match[2].matchAll(new RegExp(`<${PREFIX}measure>\\s*([^<\\s]+)\\s*<`, "g"))]
      .map((measure) => measure[1].replace(/^(iso4217|xbrli):/, ""));
    if (!measures.length) continue;
    units.set(match[1], /divide/.test(match[2]) && measures.length === 2 ? `${measures[0]}/${measures[1]}` : measures[0]);
  }

  const cover = (name: string) => xml.match(new RegExp(`<dei:${name}\\b[^>]*>\\s*([^<]+?)\\s*<`))?.[1] ?? null;
  const year = Number(cover("DocumentFiscalYearFocus"));
  const fy = Number.isInteger(year) ? year : null;
  const fp = cover("DocumentFiscalPeriodFocus");

  const tree: FactTree = {};
  for (const match of xml.matchAll(new RegExp(`<(${namespaces}):([A-Za-z0-9_]+)\\b([^>]*?)>([^<]*)</\\1:\\2>`, "g"))) {
    const [, namespace, concept, attributes, content] = match;
    if (/xsi:nil="true"/.test(attributes)) continue;
    const context = contexts.get(attributes.match(/\bcontextRef="([^"]+)"/)?.[1] ?? "");
    const unit = units.get(attributes.match(/\bunitRef="([^"]+)"/)?.[1] ?? "");
    const val = Number(content.trim());
    if (!context || !unit || content.trim() === "" || !Number.isFinite(val)) continue;
    const node = ((tree[namespace] ??= {})[concept] ??= { units: {} });
    (node.units[unit] ??= []).push({
      ...(context.start ? { start: context.start } : {}),
      end: context.end, val, accn: filing.accession, fy, fp, form: filing.form, filed: filing.filed,
    });
  }
  return tree;
}

/** One tree with another's facts added, where the same figure for the same period is not already there. */
export function mergeFactTrees(base: FactTree, extra: FactTree): FactTree {
  const merged: FactTree = structuredClone(base);
  for (const [namespace, concepts] of Object.entries(extra)) {
    for (const [concept, node] of Object.entries(concepts)) {
      const target = ((merged[namespace] ??= {})[concept] ??= { units: {} });
      for (const [unit, facts] of Object.entries(node.units)) {
        const list = (target.units[unit] ??= []);
        const seen = new Set(list.map((fact) => `${fact.start ?? ""}|${fact.end}|${fact.accn}|${fact.val}`));
        for (const fact of facts) {
          const key = `${fact.start ?? ""}|${fact.end}|${fact.accn}|${fact.val}`;
          if (!seen.has(key)) { list.push(fact); seen.add(key); }
        }
      }
    }
  }
  return merged;
}

const PERIODIC_FORMS = new Set(["10-K", "10-Q", "20-F", "40-F", "10-K/A", "10-Q/A"]);

/** The latest period any periodic report in this tree covers. */
export function newestReportedEnd(tree: FactTree): string | null {
  let newest: string | null = null;
  for (const namespace of ["us-gaap", "ifrs-full"]) {
    for (const node of Object.values(tree[namespace] ?? {})) {
      for (const facts of Object.values(node.units)) {
        for (const fact of facts) if (PERIODIC_FORMS.has(fact.form) && (newest == null || fact.end > newest)) newest = fact.end;
      }
    }
  }
  return newest;
}

/** Whether a filed report covers a later period than the feed carries. */
export function filingIsAhead(tree: FactTree, filing: { form: string; reportDate: string } | null): boolean {
  if (!filing || !PERIODIC_FORMS.has(filing.form)) return false;
  const newest = newestReportedEnd(tree);
  return newest == null || filing.reportDate > newest;
}

/** The XBRL instance among a filing's documents, as EDGAR's directory listing names them. */
export function instanceDocument(names: string[]): string | null {
  return names.find((name) => name.endsWith("_htm.xml"))
    ?? names.find((name) => name.endsWith(".xml") && !/(_cal|_def|_lab|_pre)\.xml$/.test(name) && !/^FilingSummary\.xml$/i.test(name))
    ?? null;
}

/** A line a filing's calculation linkbase adds into cash from investing activities. */
export interface InvestingLine { concept: string; prefix: string; name: string; weight: number }

/**
 * The lines a filing adds up into its cash used in investing activities.
 *
 * Read from the calculation linkbase, `*_cal.xml`, where the filer states which
 * facts sum to which total and with what sign. This is how a company's own
 * name for a line can be read without guessing at what the name means: the
 * filing itself says the line is an outflow inside investing activities.
 */
export function investingLines(calculation: string): InvestingLine[] {
  const locators = new Map<string, string>();
  for (const match of calculation.matchAll(/<(?:[\w-]+:)?loc\b([^>]*)\/?>/g)) {
    const label = match[1].match(/xlink:label="([^"]+)"/)?.[1];
    const href = match[1].match(/xlink:href="[^"#]*#([^"]+)"/)?.[1];
    if (label && href) locators.set(label, href);
  }
  const lines = new Map<string, InvestingLine>();
  for (const match of calculation.matchAll(/<(?:[\w-]+:)?calculationArc\b([^>]*)\/?>/g)) {
    const from = locators.get(match[1].match(/xlink:from="([^"]+)"/)?.[1] ?? "");
    const to = locators.get(match[1].match(/xlink:to="([^"]+)"/)?.[1] ?? "");
    const weight = Number(match[1].match(/weight="([^"]+)"/)?.[1]);
    if (!from || !to || !/_NetCashProvidedByUsedInInvestingActivities(ContinuingOperations)?$/.test(from)) continue;
    const cut = to.indexOf("_");
    if (cut < 0) continue;
    lines.set(to, { concept: to, prefix: to.slice(0, cut), name: to.slice(cut + 1), weight });
  }
  return [...lines.values()];
}

/**
 * The company's own capital-expenditure line, where it is the only one.
 *
 * ConocoPhillips files its capital expenditure as
 * `cop:PaymentToAcquireProductiveAssetsAndInvestments` — the "capital
 * expenditures and investments" line of its cash-flow statement — and no US
 * GAAP concept, so the SEC's standard feed carries no capital expenditure for
 * it since 2025. The line is accepted when the filing adds it into investing
 * activities as an outflow, its name says capital expenditure, and it is the
 * only such line. NextEra files three — its utility's, its consolidated
 * group's and its independent-power investments — and a sum of lines that may
 * restate one another is not read.
 */
export function companyCapexLine(lines: InvestingLine[]): InvestingLine | null {
  const candidates = lines.filter((line) => line.prefix !== "us-gaap" && line.weight < 0
    && /Acquire\w*ProductiveAssets|CapitalExpenditure|AdditionsToProperty|PurchasesOfProperty|PropertyPlantAndEquipment/i.test(line.name)
    && !/Proceeds|Sale|Disposal|Accrual|IncurredButNotYetPaid|IncreaseDecrease/i.test(line.name));
  return candidates.length === 1 ? candidates[0] : null;
}
