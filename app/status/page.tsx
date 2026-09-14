import type { Metadata } from "next";
import "@/app/io.css";
import { Shell } from "@/components/io/Shell";
import { Status } from "@/components/io/Status";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Data status — FinScope.io",
  description: "What FinScope holds for every company in the S&P 500, checked daily against the SEC.",
};

export default function StatusRoute() {
  return (
    <Shell>
      <main className="wrap" id="main-content" tabIndex={-1}>
        <Status />
      </main>
    </Shell>
  );
}
