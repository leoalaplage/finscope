import type { Metadata } from "next";
import "@/app/io.css";
import { MarketPage } from "@/components/MarketPage";
import { MacroSnapshot } from "@/components/io/MacroSnapshot";
import { Bonds } from "@/components/io/Bonds";
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
          * And the rate both of the rows above are discounted by.
          *
          * Every valuation on this site starts from what a government pays to
          * borrow; this is where that number comes from. The four US tenors are
          * quoted like any instrument; every other yield is struck once a
          * business day by the central bank or ministry that publishes it, and
          * an arrow turns from the US and euro curves to the other large
          * markets. France and Italy are absent because neither publishes a
          * daily figure this site can read — which `lib/bonds.ts` says in full
          * rather than filling the gap with a monthly average a month behind.
          */}
        <Bonds />
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
