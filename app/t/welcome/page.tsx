import type { Metadata } from "next";
import "@/app/io.css";
import "@/app/terminal.css";
import { Welcome } from "@/components/term/Welcome";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "Welcome · Tenqay", robots: { index: false, follow: false } };

/** The first-visit tour (components/term/Welcome.tsx), on its own: no command line, tape or status bar around it. */
export default function TerminalWelcome() {
  return <Welcome />;
}
