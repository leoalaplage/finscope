import { fcfShareGrowthProfile, type FcfShareReading } from "@/lib/io/fcf-share-growth";
import type { IoCompanyView } from "@/lib/io/view";
import { ABSENT, percent } from "./format";

function Reading({ label, reading, format }: {
  label: string;
  reading: FcfShareReading;
  format: (value: number) => string;
}) {
  const title = reading.reason
    ?? `${reading.observations} annual observations · ${reading.startDate} to ${reading.endDate}`;
  return (
    <div className="stat" title={title}>
      <div className="label">{label}</div>
      <div className="stat-value" data-empty={reading.value == null}>
        {reading.value == null ? ABSENT : format(reading.value)}
      </div>
    </div>
  );
}

export function FcfShareGrowth({ view }: { view: IoCompanyView }) {
  const profile = fcfShareGrowthProfile(view.annual);
  const hasHistory = view.annual.some((period) => period.values.freeCashFlowPerShare != null);
  if (!hasHistory) return null;
  return (
    <section className="section fcf-share-history" id="fcf-share-history">
      <div className="section-head">
        <h2 className="label">FCF / share</h2>
        <span className="label">Annual · filed figures</span>
      </div>
      <div className="grid-ruled fcf-share-growth">
        <Reading label="5Y CAGR" reading={profile.fiveYearCagr} format={(value) => percent(value, 1)} />
        <Reading label="10Y CAGR" reading={profile.tenYearCagr} format={(value) => percent(value, 1)} />
        <Reading label="R² · 5Y" reading={profile.fiveYearRSquared} format={(value) => value.toFixed(2)} />
        <Reading label="R² · 10Y" reading={profile.tenYearRSquared} format={(value) => value.toFixed(2)} />
      </div>
    </section>
  );
}
