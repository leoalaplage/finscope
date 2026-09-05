import type { Metadata } from "next";
import "@/app/io.css";
import { MarketPage } from "@/components/MarketPage";
import { MarketNews } from "@/components/io/MarketNews";
import { Shell } from "@/components/io/Shell";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Market — FinScope.io",
  description: "Track the S&P 500, Nasdaq Composite and Dow Jones across the main market timeframes.",
};

export default function MarketRoute() {
  return (
    <Shell>
      <main className="wrap market-route">
        <MarketPage indicesOnly />
        {/* Under the indices, and only here: the research workspace shares the
            component above and has its own front page to put a wire on. */}
        <MarketNews />
      </main>
    </Shell>
  );
}
