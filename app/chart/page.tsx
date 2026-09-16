import type { Metadata } from "next";
import "@/app/io.css";
import { ChartPage } from "@/components/io/ChartPage";
import { Shell } from "@/components/io/Shell";

/**
 * Prerendered, like every page here. The symbol is in the query string and
 * the browser reads it, so the document is the same for everyone.
 */
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Chart — FinScope.io",
  description: "Candlestick charts with moving averages, Bollinger Bands, RSI, MACD and Fibonacci retracements.",
};

export default function ChartRoute() {
  return (
    <Shell>
      <ChartPage initial="AAPL" />
    </Shell>
  );
}
