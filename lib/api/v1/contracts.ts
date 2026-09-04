import type { BusinessType, FactStatus, Periodicity } from "../../types";
import { KEY_VERSION } from "../../dataset-cache";

/** Public contract versions. Change these only for an intentional API or scoring change. */
export const V1_SCHEMA_VERSION = "1.0.0";
export const FINANCIAL_DATA_VERSION = `sec-normalized-${KEY_VERSION}`;
export const QUALITY_SCORE_VERSION = "qs-v3";
export const WATCHLIST_UNIVERSE_VERSION = `watchlist-v1-${KEY_VERSION}`;

export type V1Status = FactStatus;
export type V1Frequency = Periodicity | "point-in-time" | "live" | null;

export interface V1Meta {
  schemaVersion: typeof V1_SCHEMA_VERSION;
  dataVersion: string;
  scoreVersion: string | null;
  asOf: string | null;
  retrievedAt: string;
  currency: string | null;
  unit: string | null;
  frequency: V1Frequency;
  status: V1Status;
  warnings: string[];
}

export interface V1Envelope<T> {
  meta: V1Meta;
  data: T;
}

export type V1ErrorCode =
  | "invalid_request"
  | "not_found"
  | "data_building"
  | "data_unavailable"
  | "upstream_unavailable"
  | "internal_error";

export interface V1ErrorEnvelope {
  meta: V1Meta;
  error: {
    code: V1ErrorCode;
    message: string;
    retryable: boolean;
    details?: Record<string, string | number | boolean | null>;
  };
}

export interface V1CompanyIdentity {
  ticker: string;
  name: string;
  cik: string;
  exchange: string;
  sector: string;
  currency: string;
  businessType: BusinessType | null;
  description: string;
  resolutionStatus: "verified" | "partial" | "unresolved";
}

export type V1MetricUnit = "currency" | "shares" | "percent" | "perShare" | "ratio";

export interface V1FinancialValue {
  metric: string;
  label: string;
  value: number | null;
  currency: string | null;
  unit: V1MetricUnit;
  frequency: Periodicity;
  periodStart: string | null;
  periodEnd: string;
  fiscalYear: number;
  fiscalQuarter: "Q1" | "Q2" | "Q3" | "Q4" | null;
  status: V1Status;
}

export interface V1FinancialSeries {
  metric: string;
  label: string;
  currency: string | null;
  unit: V1MetricUnit;
  frequency: Periodicity;
  values: V1FinancialValue[];
}

export function v1Meta(input: Partial<Omit<V1Meta, "schemaVersion">> = {}): V1Meta {
  return {
    schemaVersion: V1_SCHEMA_VERSION,
    dataVersion: FINANCIAL_DATA_VERSION,
    scoreVersion: null,
    asOf: null,
    retrievedAt: new Date().toISOString(),
    currency: null,
    unit: null,
    frequency: null,
    status: "reported",
    warnings: [],
    ...input,
  };
}

