import type { Metadata } from "next";
import "@/app/io.css";
import "@/app/terminal.css";
import { TermShell } from "@/components/term/TermShell";
import { Welcome } from "@/components/term/Welcome";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "Welcome · Tenqay", robots: { index: false, follow: false } };

/** The first-visit tour (components/term/Welcome.tsx). */
export default function TerminalWelcome() {
  return (
    <TermShell>
      <Welcome />
    </TermShell>
  );
}
