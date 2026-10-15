import type { Metadata } from "next";
import "@/app/io.css";
import "@/app/terminal.css";
import { InsiderBuying } from "@/components/term/InsiderBuying";
import { TermShell } from "@/components/term/TermShell";

export const dynamic = "force-static";
export const metadata: Metadata = {
  title: "Insider buying — Form 4 purchases and clusters · Tenkay",
  description: "Open-market purchases by officers and directors of US-listed companies, read from SEC Form 4 filings, and the clusters of them.",
  alternates: { canonical: "/t/insiders" },
};

/** Insider buying across the index (components/term/InsiderBuying.tsx). */
export default function TerminalInsiderBuying() {
  return (
    <TermShell>
      <InsiderBuying />
    </TermShell>
  );
}
