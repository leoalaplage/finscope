import type { Metadata } from "next";
import "@/app/io.css";
import "@/app/terminal.css";
import "@/app/free-screener.css";
import { ScreenerWorkspace } from "@/components/term/ScreenerWorkspace";
import { TermPage } from "@/components/term/TermPage";
import { TermShell } from "@/components/term/TermShell";

export const dynamic = "force-static";
export const metadata: Metadata = {
  title: "Stock screener — every US-listed company · Tenkay",
  description: "Screen the S&P 500, the 1,000 largest US companies or every listed one on filed fundamentals, valuation, analysts' consensus and technicals.",
  alternates: { canonical: "/t/screener" },
};

/** Custom fundamental searches and Quality Score in the terminal EQS screen. */
export default function TerminalScreener() {
  return (
    <TermShell bare>
      <TermPage code="EQS"><ScreenerWorkspace /></TermPage>
    </TermShell>
  );
}
