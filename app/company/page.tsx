import type { Metadata } from "next";
import "@/app/io.css";
import { CompanyReturn } from "@/components/io/CompanyReturn";
import { Shell } from "@/components/io/Shell";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Company — FinScope.io",
  description: "Return to the last company you viewed on this device.",
};

export default function CompanyPage() {
  return (
    <Shell>
      <CompanyReturn />
    </Shell>
  );
}
