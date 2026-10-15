import type { Metadata } from "next";
import "@/app/io.css";
import "@/app/terminal.css";
import { Alerts } from "@/components/term/Alerts";
import { TermShell } from "@/components/term/TermShell";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "ALRT · Tenkay", robots: { index: false, follow: false } };

/** Alerts on the companies the reader follows (components/term/Alerts.tsx). */
export default function TerminalAlerts() {
  return (
    <TermShell>
      <Alerts />
    </TermShell>
  );
}
