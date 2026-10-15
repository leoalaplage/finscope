import type { Metadata } from "next";
import "@/app/io.css";
import "@/app/terminal.css";
import { Compare } from "@/components/io/Compare";
import { TermPage } from "@/components/term/TermPage";
import { TermShell } from "@/components/term/TermShell";
import { DEFAULT_WATCHLIST } from "@/lib/company-registry";

export const dynamic = "force-static";
export const metadata: Metadata = {
  title: "Compare companies side by side · Tenkay",
  description: "Compare US-listed companies on their filed financials, growth, margins and valuation.",
  alternates: { canonical: "/t/compare" },
};

const OPENING = DEFAULT_WATCHLIST.slice(0, 3).map((company) => company.ticker);

/** Several companies' filed figures side by side, in the terminal's frame. */
export default function TerminalCompare() {
  return (
    <TermShell bare>
      <TermPage code="COMP"><Compare initial={OPENING} /></TermPage>
    </TermShell>
  );
}
