import type { Metadata } from "next";
import "@/app/io.css";
import "@/app/terminal.css";
import { MarketBoard } from "@/components/term/MarketBoard";
import { TermShell } from "@/components/term/TermShell";

export const dynamic = "force-static";
export const metadata: Metadata = {
  title: "US market today — indices, sectors, rates · Tenkay",
  description: "The US market at a glance: indices, futures, sectors, the yield curve and your watchlist's performance.",
  alternates: { canonical: "/t/market" },
};

/** The terminal's market screen (components/term/MarketBoard.tsx). */
export default function TerminalMarket() {
  return (
    <TermShell>
      <MarketBoard />
    </TermShell>
  );
}
