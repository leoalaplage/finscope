import type { Metadata } from "next";
import "@/app/io.css";
import "@/app/terminal.css";
import { Portfolio } from "@/components/io/Portfolio";
import { TermPage } from "@/components/term/TermPage";
import { TermShell } from "@/components/term/TermShell";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "PORT · FinScope Terminal", robots: { index: false, follow: false } };

/** What the reader owns, read through to the businesses, in the terminal's frame. */
export default function TerminalPortfolio() {
  return (
    <TermShell bare>
      <TermPage code="PORT"><Portfolio /></TermPage>
    </TermShell>
  );
}
