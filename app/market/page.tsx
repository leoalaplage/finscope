import type { Metadata } from "next";
import "@/app/io.css";
import { MarketPage } from "@/components/MarketPage";
import { MacroSnapshot } from "@/components/io/MacroSnapshot";
import { Commodities } from "@/components/io/Commodities";
import { MarketNews } from "@/components/io/MarketNews";
import { MarketPerformance } from "@/components/io/MarketPerformance";
import { Shell } from "@/components/io/Shell";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Market — FinScope.io",
  description: "Track the S&P 500, Nasdaq Composite and Dow Jones across the main market timeframes.",
};

export default function MarketRoute() {
  return (
    <Shell>
      <main className="wrap market-route" id="main-content" tabIndex={-1}>
        <MarketPage indicesOnly />
        {/*
          * The other asset class, directly under the equity indices.
          *
          * Three indices and nothing else is one market pretending to be the
          * market. What an oil major earns, what a miner earns and what next
          * month's inflation print will read are all in the six lines below
          * and in none of the three above.
          */}
        <Commodities />
        {/*
          * The reader's own list, directly under the indices.
          *
          * The macro panel stood here, and it is the least personal thing on the
          * page: a reader opening "Market" wants to know what happened to what
          * they hold before what happened to the economy. Macro keeps its place
          * on the page, at the foot, where the wider background belongs.
          */}
        <MarketPerformance />
        {/* Under the indices, and only here: the research workspace shares the
            component above and has its own front page to put a wire on. */}
        <MarketNews />
        <MacroSnapshot />
      </main>
    </Shell>
  );
}
