"use client";

import { useEffect } from "react";
import Link from "next/link";
import { lastCompanyPath } from "@/lib/io/last-company";

/** Opens the last successfully loaded company on this device. */
export function CompanyReturn() {
  useEffect(() => { window.location.replace(lastCompanyPath()); }, []);

  return (
    <main className="wrap">
      <div className="state" role="status" aria-live="polite">
        <p className="lead num">Company</p>
        <p>Opening your last company…</p>
        <p><Link className="head-compare" href="/">Back to watchlist</Link></p>
      </div>
    </main>
  );
}
