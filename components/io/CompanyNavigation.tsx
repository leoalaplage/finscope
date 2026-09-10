"use client";

import { useEffect, useState } from "react";

export type CompanySectionId = "overview" | "valuation-section" | "financials-section" | "ownership-section" | "news-section";

const ITEMS: Array<{ id: CompanySectionId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "valuation-section", label: "Valuation" },
  { id: "financials-section", label: "Financials" },
  { id: "ownership-section", label: "Ownership" },
  { id: "news-section", label: "News" },
];

export function CompanyNavigation({ onOpen }: { onOpen: (id: CompanySectionId) => void }) {
  const [active, setActive] = useState<CompanySectionId>("overview");

  useEffect(() => {
    const sections = ITEMS.flatMap((item) => {
      const section = document.getElementById(item.id);
      return section ? [section] : [];
    });
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => Math.abs(left.boundingClientRect.top) - Math.abs(right.boundingClientRect.top))[0];
      if (visible) setActive(visible.target.id as CompanySectionId);
    }, { rootMargin: "-24% 0px -62% 0px", threshold: 0 });
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  return (
    <nav className="company-subnav" aria-label="Company sections">
      <div>
        {ITEMS.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            aria-current={active === item.id ? "location" : undefined}
            onClick={() => { setActive(item.id); onOpen(item.id); }}
          >
            {item.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
