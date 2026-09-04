import type { Metadata } from "next";
import "@/app/io.css";
import { Company } from "@/components/io/Company";
import { Shell } from "@/components/io/Shell";

/**
 * The shell around one company, and nothing more.
 *
 * Every figure on the page is fetched by the browser from endpoints that are
 * cached at the edge and in KV, so the server render here is a component
 * reference and a ticker — a few hundred bytes and no work. The alternative,
 * rendering the company on the server, would put a four-megabyte parse inside
 * every visit and put the RSC payload for it inside the HTML.
 */
export async function generateMetadata({ params }: { params: Promise<{ ticker: string }> }): Promise<Metadata> {
  const { ticker } = await params;
  const symbol = ticker.toUpperCase().slice(0, 12);
  return {
    title: `${symbol} — FinScope.io`,
    description: `Filed financials, market price and valuation for ${symbol}, read from SEC XBRL.`,
  };
}

export default async function StockPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  return (
    <Shell>
      <Company ticker={ticker.toUpperCase()} />
    </Shell>
  );
}
