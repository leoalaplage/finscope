import type { Metadata } from "next";
import "@/app/io.css";
import "@/app/terminal.css";
import { EarningsCal } from "@/components/term/EarningsCal";
import { TermShell } from "@/components/term/TermShell";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "ECAL · FinScope Terminal", robots: { index: false, follow: false } };

/** The earnings calendar (components/term/EarningsCal.tsx). */
export default function TerminalEarningsCalendar() {
  return (
    <TermShell>
      <EarningsCal />
    </TermShell>
  );
}
