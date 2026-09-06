import type { Metadata } from "next";
import "@/app/io.css";
import { Settings } from "@/components/io/Settings";
import { Shell } from "@/components/io/Shell";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Settings — FinScope.io",
  description: "Account, appearance and local-data settings for FinScope.",
};

export default function SettingsPage() {
  return (
    <Shell>
      <Settings />
    </Shell>
  );
}
