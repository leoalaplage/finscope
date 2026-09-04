import type { Metadata } from "next";
import "@/app/io.css";
import { Compare } from "@/components/io/Compare";
import { Shell } from "@/components/io/Shell";
import { DEFAULT_WATCHLIST } from "@/lib/company-registry";

/**
 * Prerendered, like every page here.
 *
 * The companies being compared live in the query string so a comparison can be
 * sent to somebody, and the browser reads them — which means this document is
 * the same constant for everyone and costs the Worker nothing.
 */
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Compare — FinScope.io",
  description: "Read the same filed figures across several US-listed companies at once.",
};

const OPENING = DEFAULT_WATCHLIST.slice(0, 3).map((company) => company.ticker);

export default function ComparePage() {
  return (
    <Shell>
      <Compare initial={OPENING} />
    </Shell>
  );
}
