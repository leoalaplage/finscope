import type { Metadata } from "next";
import "@/app/io.css";
import "@/app/terminal.css";
import { DcfScreen } from "@/components/term/DcfScreen";
import { TermPage } from "@/components/term/TermPage";
import { TermShell } from "@/components/term/TermShell";
import { DEFAULT_WATCHLIST } from "@/lib/company-registry";

export const dynamic = "force-static";
export const metadata: Metadata = {
  title: "DCF calculator from SEC filings · Tenqay",
  description: "A discounted cash flow model built from a company's own filings, with the drivers you choose.",
  alternates: { canonical: "/t/dcf" },
};

/** The discounted cash flow model on a screen of its own: the company page's DCF panel, full width. */
export default function TerminalDcf() {
  return (
    <TermShell bare>
      <TermPage code="DCF"><DcfScreen initial={DEFAULT_WATCHLIST[0].ticker} /></TermPage>
    </TermShell>
  );
}
