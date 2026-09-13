import type { Metadata } from "next";
import "@/app/io.css";
import { MarketPage } from "@/components/MarketPage";
import { MacroSnapshot } from "@/components/io/MacroSnapshot";
import { Internals } from "@/components/io/Internals";
import { Markets } from "@/components/io/Markets";
import { Wire } from "@/components/io/Wire";
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
          * Every other market, as one table rather than four grids.
          *
          * The grids were identical in shape and said nothing about which
          * mattered; a row an instrument, with the columns aligned, is what a
          * reader can actually compare down. Clicking one still opens the
          * panel the indices are drawn in.
          */}
        <Markets />
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
          * filtered to the forms that say something about a business. The wire
          * is still there, behind the second tab, for a reader who wants it.
          */}
        <Wire />
        <MacroSnapshot />
      </main>
    </Shell>
  );
}
