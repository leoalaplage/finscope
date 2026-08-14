import { FinanceApp } from "@/components/FinanceApp";
import { APPLE_DATASET } from "@/lib/demo-data";

/**
 * Renders from the traceable offline fixture, never from a live SEC fetch.
 *
 * A normalized company is about 4 MB. Fetching one here meant parsing it and
 * then serializing the whole thing into the RSC payload embedded in the HTML,
 * which exceeded the Worker's resource limits and shipped 4 MB of markup to
 * every visitor. The client replaces the fixture with live data through
 * /api/company/:ticker as soon as the app mounts.
 */
export default function Home() {
  return <FinanceApp initialData={APPLE_DATASET} />;
}
