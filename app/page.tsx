import { FinanceApp } from "@/components/FinanceApp";
import { APPLE_DATASET } from "@/lib/demo-data";

export default function Home() {
  return <FinanceApp initialData={APPLE_DATASET} />;
}
