/**
 * When a company's borrowings fall due, from its latest annual report.
 *
 * Two readings, in this order. Most filers tag the principal due in each of
 * the next five years and after (the `LongTermDebtMaturitiesRepaymentsOfPrincipal…`
 * concepts: 331 of the S&P 500's members in 2025-26). Others list their notes
 * one by one instead — NVIDIA's six issues, each with its face amount and its
 * maturity date on the debt-instrument axis — and the schedule is those notes,
 * added up by the year they mature, said as such on the page.
 *
 * Pure: facts in, schedule out. The fetching is in the endpoint.
 */

export interface MaturityBucket { label: string; value: number }

export interface DebtMaturities {
  source: "schedule" | "notes";
  /** The balance-sheet date the schedule is at. */
  asOf: string;
  filed: string;
  form: string;
  url: string | null;
  /** Year one to year five after `asOf`, then everything later. */
  buckets: MaturityBucket[];
  total: number;
  /** For a schedule rebuilt from notes: the notes themselves, soonest first. */
  notes?: Array<{ name: string; maturity: string; face: number }>;
}

export const SCHEDULE_TAGS = [
  "LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths",
  "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo",
  "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearThree",
  "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFour",
  "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFive",
  "LongTermDebtMaturitiesRepaymentsOfPrincipalAfterYearFive",
] as const;

interface ConceptFact { end: string; val: number; form?: string; filed: string; accn?: string }

const yearLabel = (asOf: string, offset: number) => `FY${String(Number(asOf.slice(0, 4)) + offset).slice(2)}`;
const labels = (asOf: string) => [1, 2, 3, 4, 5].map((offset) => yearLabel(asOf, offset)).concat(`After ${yearLabel(asOf, 5)}`);

/**
 * The tagged schedule at the latest annual balance-sheet date that carries
 * one, no older than two years: a schedule that stopped being filed in 2022 is
 * not today's (JPMorgan's).
 */
export function scheduleFromConcepts(facts: Partial<Record<(typeof SCHEDULE_TAGS)[number], ConceptFact[]>>, today = new Date()): DebtMaturities | null {
  const annual = (list: ConceptFact[] | undefined) => (list ?? []).filter((fact) => /^10-K/.test(fact.form ?? ""));
  const ends = annual(facts[SCHEDULE_TAGS[0]]).map((fact) => fact.end).sort();
  const asOf = ends.at(-1);
  if (!asOf || Date.parse(asOf) < today.getTime() - 2 * 365 * 86_400_000) return null;
  const at = (tag: (typeof SCHEDULE_TAGS)[number]) => annual(facts[tag]).filter((fact) => fact.end === asOf).sort((left, right) => right.filed.localeCompare(left.filed))[0] ?? null;
  const values = SCHEDULE_TAGS.map((tag) => at(tag));
  if (values.filter(Boolean).length < 3) return null;
  const names = labels(asOf);
  const buckets = values.map((fact, index) => ({ label: names[index], value: fact?.val ?? 0 }));
  const first = values.find(Boolean)!;
  return { source: "schedule", asOf, filed: first.filed, form: first.form ?? "10-K", url: null, buckets, total: buckets.reduce((sum, bucket) => sum + bucket.value, 0) };
}

/** The balance-sheet date plus an ISO-8601 duration, or null. */
function afterTerm(asOf: string, term: string | undefined): string | null {
  const parts = term?.match(/^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?$/);
  if (!parts || !(parts[1] || parts[2] || parts[3])) return null;
  const date = new Date(`${asOf}T12:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() + Number(parts[1] ?? 0), date.getUTCMonth() + Number(parts[2] ?? 0), date.getUTCDate() + Number(parts[3] ?? 0));
  return date.toISOString().slice(0, 10);
}

/** The maturity year a note's own name carries ("A2026NotesMember", "NotesDue2031Member"), at mid-year: the year is all it says. */
function yearInName(member: string): string | null {
  const year = member.replace(/^[a-z][\w-]*:/, "").match(/(?:^|\D)(20[2-9]\d)(?!\d)/)?.[1];
  return year ? `${year}-06-30` : null;
}

/**
 * The notes a 10-K's XBRL instance lists on the debt-instrument axis, each
 * with its face amount and maturity date at the balance-sheet date, summed by
 * the year after that date they mature in.
 */
export function scheduleFromNotes(xml: string, filing: { form: string; filed: string; url: string }): DebtMaturities | null {
  const contexts = new Map<string, { instant: string | null; end: string | null; member: string | null }>();
  for (const match of xml.matchAll(/<(?:xbrli:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:xbrli:)?context>/g)) {
    const body = match[2];
    const dims = [...body.matchAll(/dimension="([^"]+)"[^>]*>\s*([^<\s]+)\s*</g)];
    // One dimension, the debt-instrument axis: a note, and nothing else qualifying it.
    const member = dims.length === 1 && /DebtInstrumentAxis|LongtermDebtTypeAxis/i.test(dims[0][1]) ? dims[0][2] : null;
    contexts.set(match[1], {
      instant: body.match(/<(?:xbrli:)?instant>\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? null,
      end: body.match(/<(?:xbrli:)?endDate>\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? null,
      member,
    });
  }
  const asOf = xml.match(/<dei:DocumentPeriodEndDate\b[^>]*>\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  if (!asOf) return null;
  const faces = new Map<string, number>();
  const maturities = new Map<string, string>();
  const terms = new Map<string, string>();
  for (const match of xml.matchAll(/<us-gaap:(DebtInstrumentFaceAmount|DebtInstrumentCarryingAmount|DebtInstrumentMaturityDate|DebtInstrumentTerm)\b([^>]*?)>([^<]*)<\/us-gaap:\1>/g)) {
    const context = contexts.get(match[2].match(/\bcontextRef="([^"]+)"/)?.[1] ?? "");
    if (!context?.member) continue;
    const when = context.instant ?? context.end;
    if (match[1] === "DebtInstrumentMaturityDate") {
      const date = match[3].trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) maturities.set(context.member, date);
      continue;
    }
    // The time left to run, from the balance-sheet date (NVIDIA: "P0Y7M6D").
    if (match[1] === "DebtInstrumentTerm") {
      if (when === asOf) terms.set(context.member, match[3].trim());
      continue;
    }
    // The amount outstanding at the balance-sheet date; the face amount where both are tagged.
    if (when !== asOf) continue;
    const value = Number(match[3].trim());
    if (!Number.isFinite(value) || value <= 0) continue;
    if (match[1] === "DebtInstrumentFaceAmount" || !faces.has(context.member)) faces.set(context.member, value);
  }
  const notes = [...faces].flatMap(([member, face]) => {
    const maturity = maturities.get(member) ?? afterTerm(asOf, terms.get(member)) ?? yearInName(member);
    return maturity && maturity > asOf ? [{ name: member.replace(/^[a-z][\w-]*:/, "").replace(/Member$/, "").replace(/([a-z])([A-Z0-9])/g, "$1 $2"), maturity, face }] : [];
  }).sort((left, right) => left.maturity.localeCompare(right.maturity));
  if (notes.length < 2) return null;
  const names = labels(asOf);
  const end = Date.parse(asOf);
  const buckets = names.map((label) => ({ label, value: 0 }));
  for (const note of notes) {
    const years = (Date.parse(note.maturity) - end) / (365.25 * 86_400_000);
    buckets[Math.min(5, Math.max(0, Math.ceil(years) - 1))].value += note.face;
  }
  return { source: "notes", asOf, filed: filing.filed, form: filing.form, url: filing.url, buckets, total: notes.reduce((sum, note) => sum + note.face, 0), notes };
}
