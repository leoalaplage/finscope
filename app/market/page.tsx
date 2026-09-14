import type { Metadata } from "next";
import "@/app/io.css";
import { MarketPage } from "@/components/MarketPage";
import { Fold } from "@/components/io/Fold";
import { Internals } from "@/components/io/Internals";
import { MacroSnapshot } from "@/components/io/MacroSnapshot";
import { Markets } from "@/components/io/Markets";
import { MarketPerformance } from "@/components/io/MarketPerformance";
import { Shell } from "@/components/io/Shell";
import { FilingsSection, NewsSection } from "@/components/io/Wire";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Market — FinScope.io",
  description: "Track the S&P 500, Nasdaq Composite and Dow Jones across the main market timeframes.",
};

export default function MarketRoute() {
  return (
    <Shell>
      <main className="wrap market-route" id="main-content" tabIndex={-1}>
        {/*
          * Three things open, everything else a line to open.
          *
          * A first look at this page was a wall: indices, breadth, thirty
          * markets, a watchlist, two wires and a macro panel. What a reader
          * comes for is what the market did, what their own list did, and
          * what is being said — so those stay open, in that order, and the
          * rest is a named fold that costs nothing until it is opened.
          */}
        <MarketPage indicesOnly />
        <MarketPerformance />
        <NewsSection />

        <Fold title="What the market did"><Internals /></Fold>
        <Fold title="Markets"><Markets /></Fold>
        <Fold title="Filed today"><FilingsSection /></Fold>
        <Fold title="Macro"><MacroSnapshot /></Fold>
      </main>
    </Shell>
  );
}
