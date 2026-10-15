import type { Metadata } from "next";
import "@/app/io.css";
import "@/app/terminal.css";
import { TermShell } from "@/components/term/TermShell";
import { ChartWorkspace } from "@/components/term/ChartWorkspace";

/**
 * The terminal's chart workspace. Prerendered: the symbols, studies, layouts
 * and drawings are all the reader's own and live in their browser.
 */
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Stock charts with studies and drawings · Tenqay",
  description: "Daily and intraday charts for US stocks, with moving averages, RSI, MACD, Ichimoku, volume profile, comparisons and drawings.",
  alternates: { canonical: "/t/chart" },
};

export default function TerminalCharts() {
  return (
    <TermShell>
      <ChartWorkspace />
    </TermShell>
  );
}
