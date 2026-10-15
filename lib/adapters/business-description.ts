/**
 * What a company does, in its own words: the opening of "Item 1. Business" in
 * its latest annual report.
 *
 * Every 10-K opens its business section with the company describing itself —
 * what it makes, whom it sells to, how it is organised — and that is the one
 * description no other site can write better, because it is the company's,
 * filed under the securities laws. A 20-F's "Item 4. Information on the
 * Company" serves a foreign filer the same way.
 *
 * The section is found after the table of contents (whose "Item 1. Business"
 * is a link, followed by more items), and its first paragraphs that read as
 * prose are kept, up to about a thousand characters.
 */

export interface BusinessDescription { text: string; form: string; filed: string; url: string }

const HEADERS = () => ({ "User-Agent": process.env.SEC_USER_AGENT || "Tenqay research application contact@example.com" });

const decode = (text: string) => text
  .replace(/&nbsp;|&#160;|&#xa0;/gi, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
  .replace(/&#8217;|&#x2019;|&rsquo;/gi, "'").replace(/&#8220;|&#8221;|&#x201[cd];|&[lr]dquo;/gi, "\"").replace(/&#8212;|&#x2014;|&mdash;/gi, "—")
  .replace(/&#8211;|&#x2013;|&ndash;/gi, "–").replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code))).replace(/&[a-z]+;/gi, " ");

/** The document as paragraphs of plain text: block elements end one. */
export function paragraphs(html: string): string[] {
  const body = html.replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, " ")
    // Hidden XBRL header data is not prose.
    .replace(/<ix:header>[\s\S]*?<\/ix:header>/gi, " ")
    .replace(/<\/(p|div|tr|li|h\d|table)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decode(body).split(/\n+/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
}

// "Item 1. Business", "Items 1 and 2. Business and Properties", "Item 4. Information on the Company".
// Letters a document splits with a space ("Busines s") are read as one word.
const HEADING = /^i\s?t\s?e\s?m\s?s?\s*(1|4)\b[\s.:—–-]*(and\s*2[\s.:—–-]*)?(b\s?u\s?s\s?i\s?n\s?e\s?s\s?s|information on the company)\b/i;
/** Boilerplate that opens some business sections before the business: definitions, forward-looking warnings. */
const BOILERPLATE = /forward-looking|^in this (annual )?report|the terms? ["“]|as used in this|unless the context|refers? to [a-z ]+ and its (consolidated )?subsidiaries|available free of charge|our (internet|web) ?site/i;

/** The opening of the business section, from a 10-K's (or 20-F's) paragraphs. */
export function businessOpening(raw: string[]): string | null {
  // A heading split across cells ("ITEM 1." then "BUSINESS") is joined back into one line.
  const lines: string[] = [];
  for (let index = 0; index < raw.length; index++) {
    if (/^i\s?t\s?e\s?m\s?s?\s*(1|4)(\s*and\s*2)?\s*[.:]?$/i.test(raw[index]) && raw[index + 1] && raw[index + 1].length < 60) {
      lines.push(`${raw[index]} ${raw[index + 1]}`); index++;
    } else lines.push(raw[index]);
  }
  // The first heading followed by prose rather than by the next item: the table of contents' entry is not.
  for (let index = 0; index < lines.length; index++) {
    if (!HEADING.test(lines[index]) || lines[index].length > 80) continue;
    const following = lines.slice(index + 1, index + 40);
    const prose = following.filter((line) => line.length > 160 && /[a-z]\.\s|[a-z]\.$/.test(line) && !/^items?\s*\d/i.test(line));
    if (!prose.length) continue;
    // Stop at the next item heading.
    const end = following.findIndex((line) => /^item\s*1a\b|^item\s*1\s*a\b|^item\s*2\b|^item\s*3\b/i.test(line));
    const section = (end < 0 ? following : following.slice(0, end)).filter((line) => line.length > 160 && /[a-z]/.test(line) && !BOILERPLATE.test(line));
    let text = "";
    for (const paragraph of section) {
      if (text.length > 650) break;
      text += (text ? "\n\n" : "") + paragraph;
    }
    if (text.length < 120) continue;
    return text.length > 1400 ? `${text.slice(0, 1397).replace(/\s+\S*$/, "")}…` : text;
  }
  return null;
}

/** The latest annual report's primary document, from the SEC's submissions index. */
async function latestAnnual(cik: string): Promise<{ url: string; form: string; filed: string } | null> {
  const response = await fetch(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`, { headers: { ...HEADERS(), Accept: "application/json" } });
  if (!response.ok) throw new Error(`SEC returned ${response.status}.`);
  const recent = (await response.json() as { filings: { recent: { form: string[]; accessionNumber: string[]; filingDate: string[]; primaryDocument: string[] } } }).filings.recent;
  const index = recent.form.findIndex((form) => form === "10-K" || form === "20-F" || form === "40-F");
  if (index < 0) return null;
  const folder = recent.accessionNumber[index].replace(/-/g, "");
  return { url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${folder}/${recent.primaryDocument[index]}`, form: recent.form[index], filed: recent.filingDate[index] };
}

export async function fetchBusinessDescription(cik: string): Promise<BusinessDescription | null> {
  const annual = await latestAnnual(cik);
  if (!annual) return null;
  const response = await fetch(annual.url, { headers: HEADERS() });
  if (!response.ok) throw new Error(`SEC returned ${response.status}.`);
  // The business section is early in the document; five megabytes is far past it in any report.
  const html = (await response.text()).slice(0, 5_000_000);
  const text = businessOpening(paragraphs(html));
  return text ? { text, form: annual.form, filed: annual.filed, url: annual.url } : null;
}
