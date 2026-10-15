import { fetchBusinessDescription } from "./adapters/business-description";
import { cachedJson } from "./market-cache";

/**
 * What a company or a fund is, in a paragraph, with where it was read.
 *
 * Wikipedia's lead comes first: the opening section of the English article the
 * SEC filer is linked to on Wikidata, by its CIK — written to explain the
 * company to someone who does not know it, where an annual report's business
 * section is written for the regulator. Named as such, since Wikipedia's text
 * is shared under CC BY-SA, which asks for exactly that attribution. Where no
 * article is linked, the company's own words: the opening of the business
 * section of its latest annual report (lib/adapters/business-description.ts).
 */

export interface Description { text: string; source: "10-K" | "20-F" | "40-F" | "Wikipedia"; url: string; filed: string | null }

const MONTH = 30 * 86_400;
const AGENT = "Tenqay research (tenqay.com)";

/** Past this, the lead is cut at the end of a paragraph: a description, not the article. */
const MAX_CHARS = 1800;

async function fromWikipedia(cik: string): Promise<Description | null> {
  const query = `SELECT ?article WHERE { ?item wdt:P5531 "${cik.padStart(10, "0")}" . ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . } LIMIT 1`;
  const found = await fetch(`https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}`, { headers: { Accept: "application/sparql-results+json", "User-Agent": AGENT } });
  if (!found.ok) return null;
  const article = ((await found.json()) as { results: { bindings: Array<{ article: { value: string } }> } }).results.bindings[0]?.article.value;
  if (!article) return null;
  const title = decodeURIComponent(article.split("/wiki/")[1]);
  // The whole lead section as plain text, not the one-paragraph summary.
  const lead = await fetch(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(title)}`, { headers: { "User-Agent": AGENT } });
  if (!lead.ok) return null;
  const pages = ((await lead.json()) as { query?: { pages?: Record<string, { extract?: string }> } }).query?.pages ?? {};
  const text = leadText(Object.values(pages)[0]?.extract ?? "");
  return text.length >= 120 ? { text, source: "Wikipedia", url: article, filed: null } : null;
}

/** Pure: the lead's paragraphs, whole, up to the limit. */
export function leadText(extract: string, limit = MAX_CHARS): string {
  const paragraphs = extract.split(/\n+/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const kept: string[] = [];
  for (const paragraph of paragraphs) {
    if (kept.length && [...kept, paragraph].join("\n\n").length > limit) break;
    kept.push(paragraph);
  }
  return kept.join("\n\n");
}

export async function describe(cik: string): Promise<string> {
  const { body } = await cachedJson<Description | null>(`description:v2:${cik.padStart(10, "0")}`, MONTH, async () => {
    const wiki = await fromWikipedia(cik).catch(() => null);
    if (wiki) return wiki;
    const own = await fetchBusinessDescription(cik).catch(() => null);
    return own ? { text: own.text, source: own.form as Description["source"], url: own.url, filed: own.filed } : null;
  }, (value) => (value ? "full" : "empty"));
  return body;
}
