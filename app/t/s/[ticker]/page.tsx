import type { Metadata } from "next";
import "@/app/io.css";
import "@/app/terminal.css";
import { TermShell } from "@/components/term/TermShell";
import { TermCompany } from "@/components/term/TermCompany";

/**
 * One company on the terminal.
 *
 * Like /s/[ticker], the server sends a frame and a ticker and the browser asks
 * for the figures, so this costs the Worker nothing. Kept out of search results
 * while the terminal is being built beside the document site: the canonical
 * page for a company is still /s/[ticker].
 */
export async function generateMetadata({ params }: { params: Promise<{ ticker: string }> }): Promise<Metadata> {
  const { ticker } = await params;
  const symbol = ticker.toUpperCase().slice(0, 12);
  return {
    title: `${symbol} US · FinScope Terminal`,
    alternates: { canonical: `/s/${encodeURIComponent(symbol)}` },
    robots: { index: false, follow: false },
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
