import type { IoPeriod } from "./view";

export interface FcfShareReading {
  value: number | null;
  observations: number;
  startDate: string | null;
  endDate: string | null;
  reason: string | null;
}

export interface FcfShareGrowthProfile {
  fiveYearCagr: FcfShareReading;
  tenYearCagr: FcfShareReading;
  tenYearRSquared: FcfShareReading;
}

interface Point { date: string; value: number }

const YEARS_IN_MS = 365.2425 * 86_400_000;

function points(periods: IoPeriod[]): Point[] {
  return periods
    .flatMap((period) => {
      const value = period.values.freeCashFlowPerShare;
      return value != null && Number.isFinite(value) ? [{ date: period.end, value }] : [];
    })
    .sort((left, right) => left.date.localeCompare(right.date));
}

const elapsedYears = (start: string, end: string) =>
  (Date.parse(end) - Date.parse(start)) / YEARS_IN_MS;

function cagr(history: Point[], targetYears: 5 | 10): FcfShareReading {
  const end = history.at(-1);
  if (!end) return { value: null, observations: 0, startDate: null, endDate: null, reason: "No annual FCF / share history" };
  const start = history
    .slice(0, -1)
    .map((point) => ({ point, years: elapsedYears(point.date, end.date) }))
    .filter((candidate) => candidate.years > 0 && Math.abs(candidate.years - targetYears) <= .5)
    .sort((left, right) => Math.abs(left.years - targetYears) - Math.abs(right.years - targetYears))[0]?.point;
  if (!start) {
    return {
      value: null,
      observations: history.length,
      startDate: history[0]?.date ?? null,
      endDate: end.date,
      reason: `No comparable endpoint around ${targetYears} years ago`,
    };
  }
  if (start.value <= 0 || end.value <= 0) {
    return {
      value: null,
      observations: history.filter((point) => point.date >= start.date).length,
      startDate: start.date,
      endDate: end.date,
      reason: "CAGR is not meaningful with a zero or negative endpoint",
    };
  }
  const years = elapsedYears(start.date, end.date);
  return {
    value: (end.value / start.value) ** (1 / years) - 1,
    observations: history.filter((point) => point.date >= start.date).length,
    startDate: start.date,
    endDate: end.date,
    reason: null,
  };
}

function consistency(history: Point[], targetYears: 10): FcfShareReading {
  const end = history.at(-1);
  if (!end) return { value: null, observations: 0, startDate: null, endDate: null, reason: "No annual FCF / share history" };
  const window = history.filter((point) => {
    const years = elapsedYears(point.date, end.date);
    return years >= 0 && years <= targetYears + .5;
  });
  if (window.length < 3) {
    return {
      value: null,
      observations: window.length,
      startDate: window[0]?.date ?? null,
      endDate: end.date,
      reason: "R² needs at least three annual observations",
    };
  }
  if (window.some((point) => point.value <= 0)) {
    return {
      value: null,
      observations: window.length,
      startDate: window[0].date,
      endDate: end.date,
      reason: "A zero or negative year makes the log-linear fit undefined",
    };
  }

  const first = window[0].date;
  const samples = window.map((point) => ({ x: elapsedYears(first, point.date), y: Math.log(point.value) }));
  const meanX = samples.reduce((sum, point) => sum + point.x, 0) / samples.length;
  const meanY = samples.reduce((sum, point) => sum + point.y, 0) / samples.length;
  let sxx = 0; let sxy = 0; let syy = 0;
  for (const point of samples) {
    const dx = point.x - meanX;
    const dy = point.y - meanY;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) {
    return {
      value: null,
      observations: window.length,
      startDate: first,
      endDate: end.date,
      reason: "The series does not vary enough for R²",
    };
  }
  return {
    value: Math.min(1, Math.max(0, (sxy * sxy) / (sxx * syy))),
    observations: window.length,
    startDate: first,
    endDate: end.date,
    reason: null,
  };
}

/** FCF/share growth and regularity from the validated annual series only. */
export function fcfShareGrowthProfile(periods: IoPeriod[]): FcfShareGrowthProfile {
  const history = points(periods);
  return {
    fiveYearCagr: cagr(history, 5),
    tenYearCagr: cagr(history, 10),
    tenYearRSquared: consistency(history, 10),
  };
}
