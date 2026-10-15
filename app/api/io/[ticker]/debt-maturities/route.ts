import { NextResponse } from "next/server";
import { SCHEDULE_TAGS, scheduleFromConcepts, scheduleFromNotes, type DebtMaturities } from "@/lib/debt-maturities";
import { instanceDocument } from "@/lib/adapters/xbrl-instance";
import { secFetch } from "@/lib/adapters/sec-fetch";
import { cachedJson } from "@/lib/market-cache";
import { TICKER_PATTERN } from "@/lib/market-profile";

/**
 * When the company's debt falls due (lib/debt-maturities.ts): the schedule it
 * tags, or its notes added up by year, from its latest 10-K. Kept a week —
 * it changes once a year.
 */
const SEC_AGENT = () => process.env.SEC_USER_AGENT || "Tenkay research application contact@example.com";
const json = async <T,>(url: string): Promise<T | null> => {
  const response = await secFetch(url, { headers: { "User-Agent": SEC_AGENT(), Accept: "application/json" } });
  if (response.status === 404) { await response.body?.cancel(); return null; }
  if (!response.ok) throw new Error(`SEC returned ${response.status}.`);
  return response.json() as Promise<T>;
};

async function build(cik: string): Promise<{ maturities: DebtMaturities | null }> {
  const padded = cik.padStart(10, "0");
  const concepts = await Promise.all(SCHEDULE_TAGS.map((tag) =>
    json<{ units?: { USD?: Array<{ end: string; val: number; form?: string; filed: string }> } }>(`https://data.sec.gov/api/xbrl/companyconcept/CIK${padded}/us-gaap/${tag}.json`)));
  const schedule = scheduleFromConcepts(Object.fromEntries(SCHEDULE_TAGS.map((tag, index) => [tag, concepts[index]?.units?.USD ?? []])));
  if (schedule) return { maturities: schedule };
  // No tagged schedule: the notes the latest 10-K lists.
  const submissions = await json<{ filings: { recent: { form: string[]; accessionNumber: string[]; filingDate: string[] } } }>(`https://data.sec.gov/submissions/CIK${padded}.json`);
  const recent = submissions?.filings.recent;
  const at = recent?.form.findIndex((form) => form === "10-K") ?? -1;
  if (!recent || at < 0) return { maturities: null };
  const folder = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${recent.accessionNumber[at].replace(/-/g, "")}/`;
  const listing = await json<{ directory: { item: Array<{ name: string }> } }>(`${folder}index.json`);
  const instance = listing ? instanceDocument(listing.directory.item.map((item) => item.name)) : null;
  if (!instance) return { maturities: null };
  const response = await secFetch(`${folder}${instance}`, { headers: { "User-Agent": SEC_AGENT() } });
  if (!response.ok) throw new Error(`SEC returned ${response.status}.`);
  return { maturities: scheduleFromNotes((await response.text()).slice(0, 25_000_000), { form: "10-K", filed: recent.filingDate[at], url: `${folder}${recent.accessionNumber[at]}-index.htm` }) };
}

export async function GET(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const symbol = (await context.params).ticker.toUpperCase();
  const cik = new URL(request.url).searchParams.get("cik") ?? "";
  if (!TICKER_PATTERN.test(symbol) || !/^\d{1,10}$/.test(cik)) return NextResponse.json({ error: "A valid exchange symbol and SEC CIK are required." }, { status: 400 });
  try {
    const { body } = await cachedJson(`debt-maturities:v2:${cik.padStart(10, "0")}`, 7 * 86_400, () => build(cik), (value) => (value.maturities ? "full" : "partial"));
    return new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600, s-maxage=86400" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The filing could not be read." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
