import type { Metadata } from "next";
import "@/app/io.css";
import "@/app/terminal.css";
import { TermShell } from "@/components/term/TermShell";
import { ChartWorkspace } from "@/components/term/ChartWorkspace";

/**
 * The terminal's chart workspace. Prerendered: the symbols, studies, layouts
 * and drawings are all the reader's own and live in their browser.
 */
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Charts · FinScope Terminal",
  robots: { index: false, follow: false },
};

export default function TerminalCharts() {
  return (
    <TermShell>
      <ChartWorkspace />
    </TermShell>
  );
}
