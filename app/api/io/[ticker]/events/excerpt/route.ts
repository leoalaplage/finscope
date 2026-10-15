import { NextResponse } from "next/server";
import { itemExcerpts } from "@/lib/adapters/filing-events";
import { paragraphs } from "@/lib/adapters/business-description";
import { secFetch } from "@/lib/adapters/sec-fetch";
import { cachedJson } from "@/lib/market-cache";

/**
 * The opening sentences of each item of one 8-K, read from the filing itself
 * when a reader opens the event. A filing never changes, so each is read once.
 */
const SEC_AGENT = () => process.env.SEC_USER_AGENT || "Tenqay research application contact@example.com";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const cik = params.get("cik") ?? "";
  const accession = params.get("accession") ?? "";
  const document = params.get("document") ?? "";
  const items = (params.get("items") ?? "").split(",").filter((code) => /^\d\.\d\d$/.test(code)).slice(0, 8);
  // Only an EDGAR document of this filer: nothing else is ever fetched on a reader's say-so.
  if (!/^\d{1,10}$/.test(cik) || !/^\d{10}-\d{2}-\d{6}$/.test(accession) || !/^[\w.-]+\.html?$/i.test(document) || !items.length) {
    return NextResponse.json({ error: "A filer, an accession, a document and its items are required." }, { status: 400 });
  }
  try {
    const { body } = await cachedJson(`event-excerpt:v2:${accession}:${items.join(",")}`, 30 * 86_400, async () => {
      const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}/${document}`;
      const response = await secFetch(url, { headers: { "User-Agent": SEC_AGENT(), Accept: "text/html" } });
      if (!response.ok) throw new Error(`SEC returned ${response.status}.`);
      return { excerpts: itemExcerpts(paragraphs((await response.text()).slice(0, 2_000_000)), items) };
    });
    return new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=86400, s-maxage=86400" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The filing could not be read." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
