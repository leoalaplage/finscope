import type { Metadata } from "next";
import "@/app/io.css";
import "@/app/terminal.css";
import { TermShell } from "@/components/term/TermShell";
import { Launchpad } from "@/components/term/Launchpad";

/**
 * The terminal's front screen, prerendered like the document site's.
 *
 * For now the reader's watchlist with today's move, and how to drive the
 * command line; the full launchpad — heat map, news, macro, the earnings
 * calendar — is a later phase.
 */
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "FinScope Terminal",
  robots: { index: false, follow: false },
};

export default function TerminalHome() {
  return (
    <TermShell>
      <Launchpad />
    </TermShell>
  );
}
