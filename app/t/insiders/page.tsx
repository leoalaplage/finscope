import type { Metadata } from "next";
import "@/app/io.css";
import "@/app/terminal.css";
import { InsiderBuying } from "@/components/term/InsiderBuying";
import { TermShell } from "@/components/term/TermShell";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "INSB · FinScope Terminal", robots: { index: false, follow: false } };

/** Insider buying across the index (components/term/InsiderBuying.tsx). */
export default function TerminalInsiderBuying() {
  return (
    <TermShell>
      <InsiderBuying />
    </TermShell>
  );
}
