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
/**
 * Prerendered at build time and served straight from the asset store.
 *
 * This page takes no input: it renders a constant fixture and the client
 * replaces it moments later. Left dynamic, every single visit paid for a
 * server render of the whole application tree inside the Worker — and when the
 * platform throttles CPU, that is the request that fails, so the site itself
 * returned "Worker exceeded resource limits" rather than merely loading slowly.
 * Static means the document costs no Worker CPU at all and cannot fail that way.
 */
export const dynamic = "force-static";

export default function Home() {
  return <FinanceApp initialData={APPLE_DATASET} />;
}
