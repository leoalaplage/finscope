import type { Metadata } from "next";
import "@/app/io.css";
import "@/app/terminal.css";
import { TermShell } from "@/components/term/TermShell";
import { TermCompany } from "@/components/term/TermCompany";
import { companyByTicker } from "@/lib/company-registry";
import { universeMember } from "@/lib/universe";

/**
 * One company on the terminal.
 *
 * Like /s/[ticker], the server sends a frame and a ticker and the browser asks
 * for the figures, so this costs the Worker nothing. The company's page on
 * FinScope, and its canonical address (the former /s/[ticker] leads here).
 */
export async function generateMetadata({ params }: { params: Promise<{ ticker: string }> }): Promise<Metadata> {
  const { ticker } = await params;
  const symbol = ticker.toUpperCase().slice(0, 12);
  const name = companyByTicker(symbol)?.name ?? universeMember(symbol)?.name ?? null;
  const who = name ? `${name} (${symbol})` : symbol;
  return {
    title: `${who} — financials, valuation and filings · FinScope`,
    description: `${who}: filed financials, operating figures, earnings against the consensus, valuation, DCF, dividends, insider dealing and SEC filings.`,
    alternates: { canonical: `/t/s/${encodeURIComponent(symbol)}` },
  };
}

export default async function TerminalStockPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const symbol = ticker.toUpperCase();
  return (
    <TermShell ticker={symbol}>
      <TermCompany ticker={symbol} />
    </TermShell>
  );
}
