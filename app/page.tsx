import { FinanceApp } from "@/components/FinanceApp";
import { APPLE_DATASET } from "@/lib/demo-data";
import { fetchSecCompany } from "@/lib/adapters/sec";

export default async function Home() {
  let initialData = APPLE_DATASET;
  try {
    initialData = await fetchSecCompany("AAPL");
  } catch {
    // The traceable fixture keeps the product usable when SEC is temporarily unavailable.
  }
  return <FinanceApp initialData={initialData} />;
}
