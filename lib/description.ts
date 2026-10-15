import { fetchBusinessDescription } from "./adapters/business-description";
import { cachedJson } from "./market-cache";

/**
 * What a company or a fund is, in a paragraph, with where it was read.
 *
 * The company's own words come first: the opening of the business section of
 * its latest annual report (lib/adapters/business-description.ts). Where that
 * cannot be read — some reports lay the section out in ways no rule finds —
 * the English Wikipedia article the SEC filer is linked to on Wikidata, by its
 * CIK, is summarised instead, and named as such: Wikipedia's text is shared
 * under CC BY-SA, which asks for exactly that attribution.
 */

export interface Description { text: string; source: "10-K" | "20-F" | "40-F" | "Wikipedia"; url: string; filed: string | null }

const MONTH = 30 * 86_400;
const AGENT = "Tenkay research (finscope.io)";

async function fromWikipedia(cik: string): Promise<Description | null> {
  const query = `SELECT ?article WHERE { ?item wdt:P5531 "${cik.padStart(10, "0")}" . ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . } LIMIT 1`;
  const found = await fetch(`https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}`, { headers: { Accept: "application/sparql-results+json", "User-Agent": AGENT } });
  if (!found.ok) return null;
  const article = ((await found.json()) as { results: { bindings: Array<{ article: { value: string } }> } }).results.bindings[0]?.article.value;
  if (!article) return null;
  const title = article.split("/wiki/")[1];
  const summary = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${title}`, { headers: { "User-Agent": AGENT } });
  if (!summary.ok) return null;
  const body = await summary.json() as { extract?: string; content_urls?: { desktop?: { page?: string } } };
  return body.extract ? { text: body.extract, source: "Wikipedia", url: body.content_urls?.desktop?.page ?? article, filed: null } : null;
}

export async function describe(cik: string): Promise<string> {
  const { body } = await cachedJson<Description | null>(`description:v1:${cik.padStart(10, "0")}`, MONTH, async () => {
    const own = await fetchBusinessDescription(cik).catch(() => null);
    if (own) return { text: own.text, source: own.form as Description["source"], url: own.url, filed: own.filed };
    return fromWikipedia(cik).catch(() => null);
  }, (value) => (value ? "full" : "empty"));
  return body;
}
