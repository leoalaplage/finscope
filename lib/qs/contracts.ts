export interface QsStructuredInput {
  ticker: string;
  sector: string;
  /** Market capitalisation in billions, the QS engine's canonical money scale. */
  marketCapBillions: number | null;
  /** Values use the engine's stable metric keys and percentage-points convention. */
  metrics: Record<string, number | null>;
  references: {
    operatingCashFlowBillions: number | null;
    capexBillions: number | null;
    peg: number | null;
  };
}

