import type { Metadata } from "next";
import "@/app/io.css";
import "@/app/terminal.css";
import { TermPortfolio } from "@/components/term/TermPortfolio";
import { TermShell } from "@/components/term/TermShell";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "PORT · Tenkay", robots: { index: false, follow: false } };

/** The book, as a risk desk reads it (components/term/TermPortfolio.tsx). */
export default function TerminalPortfolio() {
  return (
    <TermShell>
      <TermPortfolio />
    </TermShell>
  );
}
