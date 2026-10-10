import type { Metadata } from "next";
import "@/app/io.css";
import "@/app/terminal.css";
import { Dcf } from "@/components/io/Dcf";
import { TermPage } from "@/components/term/TermPage";
import { TermShell } from "@/components/term/TermShell";
import { DEFAULT_WATCHLIST } from "@/lib/company-registry";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "DCF · FinScope Terminal", robots: { index: false, follow: false } };

/** The discounted cash flow model, in the terminal's frame. */
export default function TerminalDcf() {
  return (
    <TermShell bare>
      <TermPage code="DCF"><Dcf initial={DEFAULT_WATCHLIST[0].ticker} /></TermPage>
    </TermShell>
  );
}
