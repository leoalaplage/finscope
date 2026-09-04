import type { Metadata } from "next";
import "@/app/io.css";
import { Screener } from "@/components/io/Screener";
import { Shell } from "@/components/io/Shell";

/**
 * Prerendered, and scored entirely in the browser.
 *
 * The engine is a pure function over a table, so the Worker never runs it: the
 * page fetches the digests it already stores, builds the table, and scores it
 * on the reader's machine. Nothing about the list is uploaded.
 */
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "QS Screener — FinScope.io",
  description: "Four pillars, a weighted score and a letter grade over the companies you follow.",
};

export default function ScreenerPage() {
  return (
    <Shell>
      <Screener />
    </Shell>
  );
}
