/**
 * The slices of a company a filing breaks its figures into, read from the
 * filing's own XBRL instance.
 *
 * SEC Company Facts — the feed every other figure on this site comes from —
 * carries only facts without a dimension, so a segment never reaches it:
 * Alphabet's Google Cloud revenue, operating income and backlog are in every
 * 10-Q, tagged against `StatementBusinessSegmentsAxis`, and nowhere in the
 * feed. This reads them from the instance document instead.
 *
 * Kept: revenue, operating income and remaining performance obligations
 * (backlog), on the business-segment, product-or-service and geographic axes,
 * one or two axes deep (Alphabet's Search sits inside Google Services). A
 * context on any other axis — hedges, equity components, legal entities — is
 * not a segment and is skipped.
 *
 * Pure: a string in, facts out.
 */

export type SegmentMeasure = "revenue" | "operatingIncome" | "backlog";
export type SegmentAxis = "business" | "product" | "geography";

export interface SegmentFact {
  measure: SegmentMeasure;
  concept: string;
  /**
   * One or two members, outermost axis first: [["product", "goog:GoogleSearchOtherMember"], ["business", "goog:GoogleServicesMember"]].
   * None for the consolidated figure, kept as the total the slices are checked against.
   */
  members: Array<[SegmentAxis, string]>;
  start: string | null;
  end: string;
  value: number;
  currency: string;
  accession: string;
  filed: string;
  form: string;
}

const MEASURES: Record<string, SegmentMeasure> = {
  "us-gaap:Revenues": "revenue",
  "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax": "revenue",
  "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax": "revenue",
  "us-gaap:RevenuesNetOfInterestExpense": "revenue",
  "us-gaap:SalesRevenueNet": "revenue",
  "us-gaap:OperatingIncomeLoss": "operatingIncome",
  "us-gaap:RevenueRemainingPerformanceObligation": "backlog",
};

const AXES: Record<string, SegmentAxis> = {
  "us-gaap:StatementBusinessSegmentsAxis": "business",
  "srt:ProductOrServiceAxis": "product",
  "us-gaap:ProductOrServiceAxis": "product",
  "srt:StatementGeographicalAxis": "geography",
  "us-gaap:StatementGeographicalAxis": "geography",
};
/**
 * The consolidation axis says which part of the reconciliation a figure is.
 * Operating segments are the segments themselves; the corporate line is the
 * unallocated remainder, kept as a segment of its own so the parts add up;
 * eliminations and reconciling items are not a slice of anything.
 */
const CONSOLIDATION = "srt:ConsolidationItemsAxis";
const CORPORATE = new Set(["us-gaap:CorporateNonSegmentMember", "us-gaap:AllOtherSegmentsMember"]);

interface Context { members: Array<[SegmentAxis, string]> | null; start: string | null; end: string | null }

function contexts(xml: string): Map<string, Context> {
  const out = new Map<string, Context>();
  for (const match of xml.matchAll(/<(?:xbrli:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:xbrli:)?context>/g)) {
    const body = match[2];
    const explicit = [...body.matchAll(/<xbrldi:explicitMember\b[^>]*dimension="([^"]+)"[^>]*>\s*([^<\s]+)\s*<\/xbrldi:explicitMember>/g)];
    // A typed dimension is never a segment axis here.
    let members: Array<[SegmentAxis, string]> | null = /<xbrldi:typedMember\b/.test(body) ? null : [];
    for (const [, dimension, member] of explicit) {
      const axis = AXES[dimension];
      if (axis) { members?.push([axis, member]); continue; }
      if (dimension === CONSOLIDATION && member === "us-gaap:OperatingSegmentsMember") continue;
      if (dimension === CONSOLIDATION && CORPORATE.has(member)) { members?.push(["business", member]); continue; }
      members = null;
    }
    // No member at all is the consolidated figure; members that all fell away
    // ("the operating segments together") are a subtotal, not a slice.
    if (members && (members.length > 2 || (explicit.length && !members.length))) members = null;
    const start = body.match(/<(?:xbrli:)?startDate>\s*([^<\s]+)\s*</)?.[1] ?? null;
    const end = body.match(/<(?:xbrli:)?(?:endDate|instant)>\s*([^<\s]+)\s*</)?.[1] ?? null;
    // The product axis first, then the business segment it sits in.
    members?.sort((left, right) => ["product", "geography", "business"].indexOf(left[0]) - ["product", "geography", "business"].indexOf(right[0]));
    out.set(match[1], { members, start, end });
  }
  return out;
}

export function parseSegmentFacts(xml: string, filing: { accession: string; filed: string; form: string }): SegmentFact[] {
  const context = contexts(xml);
  const units = new Map<string, string>();
  for (const match of xml.matchAll(/<(?:xbrli:)?unit\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:xbrli:)?unit>/g)) {
    const measure = match[2].match(/<(?:xbrli:)?measure>\s*(?:iso4217:)?([A-Z]{3})\s*</);
    if (measure) units.set(match[1], measure[1]);
  }
  const facts: SegmentFact[] = [];
  for (const match of xml.matchAll(/<((?:us-gaap):[A-Za-z]+)\b([^>]*)>([^<]+)<\/\1>/g)) {
    const measure = MEASURES[match[1]];
    if (!measure) continue;
    const attributes = match[2];
    const ref = attributes.match(/contextRef="([^"]+)"/)?.[1];
    const unit = attributes.match(/unitRef="([^"]+)"/)?.[1];
    const where = ref ? context.get(ref) : undefined;
    if (!where?.members || !where.end) continue;
    const currency = unit ? units.get(unit) : undefined;
    const value = Number(match[3].trim());
    if (!currency || !Number.isFinite(value)) continue;
    // A negative "revenue" in a segment table is an elimination by another name.
    if (measure === "revenue" && value < 0) continue;
    facts.push({ measure, concept: match[1], members: where.members, start: where.start, end: where.end, value, currency, ...filing });
  }
  return facts;
}

/**
 * Member names as the filing labels them: "goog:GoogleCloudMember" → "Google
 * Cloud". The label linkbase gives the company's own words; a member without
 * one there (a standard taxonomy member) is read from its name. Linkbases are
 * written with the `link:` prefix (Alphabet) or in the default namespace
 * (Ball); both are read.
 */
export function parseLabels(labelXml: string): Map<string, string> {
  const labelText = new Map<string, { text: string; role: string }[]>();
  for (const match of labelXml.matchAll(/<(?:link:)?label\b([^>]*)>([\s\S]*?)<\/(?:link:)?label>/g)) {
    const id = match[1].match(/xlink:label="([^"]+)"/)?.[1];
    const role = match[1].match(/xlink:role="([^"]+)"/)?.[1] ?? "";
    if (!id) continue;
    const text = match[2].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();
    labelText.set(id, [...(labelText.get(id) ?? []), { text, role }]);
  }
  const locs = new Map<string, string>();
  for (const match of labelXml.matchAll(/<(?:link:)?loc\b([^>]*)\/?>/g)) {
    const href = match[1].match(/xlink:href="[^"#]*#([^"]+)"/)?.[1];
    const id = match[1].match(/xlink:label="([^"]+)"/)?.[1];
    if (href && id) locs.set(id, href);
  }
  const names = new Map<string, string>();
  for (const match of labelXml.matchAll(/<(?:link:)?labelArc\b([^>]*)\/?>/g)) {
    const from = match[1].match(/xlink:from="([^"]+)"/)?.[1];
    const to = match[1].match(/xlink:to="([^"]+)"/)?.[1];
    const element = from ? locs.get(from) : undefined;
    const labels = to ? labelText.get(to) : undefined;
    if (!element || !labels?.length || !element.endsWith("Member")) continue;
    const terse = labels.find((label) => label.role.endsWith("/terseLabel"));
    const standard = labels.find((label) => label.role.endsWith("/label"));
    const text = (terse ?? standard ?? labels[0]).text.replace(/\s*\[Member\]\s*$/i, "").trim();
    // goog_GoogleCloudMember → goog:GoogleCloudMember, as the instance writes it.
    names.set(element.replace("_", ":"), text);
  }
  return names;
}

const KNOWN: Record<string, string> = { "us-gaap:CorporateNonSegmentMember": "Corporate and unallocated", "us-gaap:AllOtherSegmentsMember": "All other", US: "United States", "country:US": "United States", "country:CN": "China", "country:JP": "Japan", "country:TW": "Taiwan", "country:GB": "United Kingdom", "country:DE": "Germany", "country:IE": "Ireland", "country:SG": "Singapore", "country:CA": "Canada" };

/** A member's name read from the element itself where the filing gives no label. */
export function memberName(member: string, labels: Map<string, string>): string {
  // A standard member keeps the taxonomy's wording in many linkbases ("Segment Reporting, Reconciling Item, Corporate Nonsegment"); plain words read better.
  if (labels.has(member) && !(KNOWN[member] && /^Segment Reporting/i.test(labels.get(member)!))) return labels.get(member)!;
  if (KNOWN[member]) return KNOWN[member];
  const local = member.split(":").pop()!.replace(/Member$/, "");
  return local
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\bAnd\b/g, "and").replace(/\bOf\b/g, "of")
    .trim();
}
