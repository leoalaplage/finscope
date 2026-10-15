import type { Metadata } from "next";
import "@/app/io.css";
import "@/app/terminal.css";
import { TermSettings } from "@/components/term/TermSettings";
import { TermShell } from "@/components/term/TermShell";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "SET · Tenkay", robots: { index: false, follow: false } };

/** The terminal's settings (components/term/TermSettings.tsx). */
export default function TerminalSettings() {
  return (
    <TermShell>
      <TermSettings />
    </TermShell>
  );
}
