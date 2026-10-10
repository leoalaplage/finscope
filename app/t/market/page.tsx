import type { Metadata } from "next";
import "@/app/io.css";
import "@/app/terminal.css";
import { MarketPage } from "@/components/MarketPage";
import { Internals } from "@/components/io/Internals";
import { Markets } from "@/components/io/Markets";
import { MarketPerformance } from "@/components/io/MarketPerformance";
import { TermPage } from "@/components/term/TermPage";
import { TermShell } from "@/components/term/TermShell";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "MKT · FinScope Terminal", robots: { index: false, follow: false } };

/**
 * The market page's readings with nothing folded: the indices over the
 * session, the watchlist's performance, breadth, and the thirty markets. The
 * wire, filings and macro are on the launchpad.
 */
export default function TerminalMarket() {
  return (
    <TermShell>
      <TermPage code="MKT">
        <div className="wrap market-route">
          <MarketPage indicesOnly />
          <MarketPerformance />
          <Internals />
          <Markets />
        </div>
      </TermPage>
    </TermShell>
  );
}
