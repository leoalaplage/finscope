import type { Metadata } from "next";
import "@/app/io.css";
import "@/app/terminal.css";
import { Scanner } from "@/components/term/Scanner";
import { TermShell } from "@/components/term/TermShell";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "SCAN · FinScope Terminal", robots: { index: false, follow: false } };

/** The technical scanner (components/term/Scanner.tsx). */
export default function TerminalScan() {
  return (
    <TermShell>
      <Scanner />
    </TermShell>
  );
}
