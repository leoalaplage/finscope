import type { Metadata } from "next";
import "@/app/io.css";
import { Dcf } from "@/components/io/Dcf";
import { Shell } from "@/components/io/Shell";
import { DEFAULT_WATCHLIST } from "@/lib/company-registry";

/**
 * Prerendered, like every page here.
 *
 * The company being valued lives in the query string so a valuation can be
 * sent to somebody, and the browser reads it — which means this document is
 * the same constant for everyone and costs the Worker nothing.
 */
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "DCF — FinScope.io",
  description: "What a price is asking for, what a company has delivered, and how much room is left between them.",
};

export default function DcfPage() {
  return (
    <Shell>
      <Dcf initial={DEFAULT_WATCHLIST[0].ticker} />
    </Shell>
  );
}
