import type { Metadata } from "next";
import "@/app/io.css";
import "@/app/terminal.css";
import { TermShell } from "@/components/term/TermShell";
import { Launchpad } from "@/components/term/Launchpad";

/**
 * The terminal's front screen, prerendered like the document site's.
 *
 * For now the reader's watchlist with today's move, and how to drive the
 * command line; the full launchpad — heat map, news, macro, the earnings
 * calendar — is a later phase.
 */
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Tenqay — a terminal for every US-listed company",
  description: "Filed financials, operating figures, valuation, insider buying and the market for every company that files with the SEC, in one terminal.",
  alternates: { canonical: "/t" },
};

export default function TerminalHome() {
  return (
    <TermShell>
      <Launchpad />
    </TermShell>
  );
}
