import type { Metadata } from "next";
import "@/app/io.css";
import { MarketPage } from "@/components/MarketPage";
import { MacroSnapshot } from "@/components/io/MacroSnapshot";
import { Bonds } from "@/components/io/Bonds";
import { Commodities } from "@/components/io/Commodities";
import { Internals } from "@/components/io/Internals";
import { Strip } from "@/components/io/Strip";
import { Filings } from "@/components/io/Filings";
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
        {/*
          * What the market did, before what any one thing costs.
          *
          * Three index levels say the market rose; they do not say whether it
          * rose because four hundred companies rose or because five did. That
          * reading comes from the index table the screener's scheduled run
          * already prices, so it costs this page nothing and it is the first
          * thing a reader wants after the charts.
          */}
        <Internals />
        {/*
          * The rest of the world's equities, under America's.
          *
          * A page called "Market" showing three US indices is a page about one
          * country, and the government bonds two rows below already price
          * Tokyo and London.
          */}
        <Strip set="world" title="World indices" aside="Local currency" label="index"/>
        <Commodities />
        {/*
          * And the rate both of the rows above are discounted by.
          *
          * Every valuation on this site starts from what a government pays to
          * borrow; this is where that number comes from. The four US tenors are
          * quoted like any instrument; every other yield is struck once a
          * business day by the central bank or ministry that publishes it, and
          * an arrow turns from the US and euro curves to the other large
          * markets. France and Italy are absent because their daily figures are
          * Euronext's to license — which `lib/bonds.ts` says in full rather than
          * filling the gap with a monthly average a month behind.
          */}
        <Bonds />
        {/*
          * And what the currencies those are quoted in are worth.
          *
          * Oil in dollars, a gilt in sterling, a Bund in euros — the page
          * priced all three and said nothing about what they are worth
          * against each other.
          */}
        <Strip set="currencies" title="Currencies" aside="Spot rates" label="currency"/>
        {/*
          * The reader's own list, directly under the indices.
          *
          * The macro panel stood here, and it is the least personal thing on the
          * page: a reader opening "Market" wants to know what happened to what
          * they hold before what happened to the economy. Macro keeps its place
          * on the page, at the foot, where the wider background belongs.
          */}
        <MarketPerformance />
        {/*
          * What the companies here told the market, in place of a news wire.
          *
          * The wire was general: of eighteen headlines it carried, ten were
          * political, six were about wars, one was a Formula One result and
          * one was about a company. This is the same material every figure on
          * this site comes from — EDGAR's index of what was accepted today,
          * filtered to the forms that say something about a business.
          */}
        <Filings />
        <MacroSnapshot />
      </main>
    </Shell>
  );
}
