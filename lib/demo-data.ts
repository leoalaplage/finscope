import type { CompanyDataset, FinancialPeriod, MetricKey, NormalizedFact } from "./types";
import { COMPANIES } from "./company-registry";

const retrievedAt = "2026-08-13T08:00:00.000Z";
type Row = [number, string, string, string, number, number, number, number, number | null, number | null, number, number | null];

// Auditable offline fixture extracted from SEC Company Facts for Apple. Missing facts stay null.
const rows: Row[] = [
  [2009,"2009-09-26","2009-10-27","0001193125-09-214859",36537,13140,7658,5704,10159,null,907.005,null],
  [2010,"2010-09-25","2010-10-27","0001193125-10-238044",65225,25684,18385,14013,18595,null,924.712,null],
  [2011,"2011-09-24","2011-10-26","0001193125-11-282113",108249,43818,33790,25922,37529,null,936.645,null],
  [2012,"2012-09-29","2012-10-31","0001193125-12-444068",156508,68662,55241,41733,50856,null,945.355,null],
  [2013,"2013-09-28","2013-10-30","0001193125-13-416534",170910,64304,48999,37037,53666,null,931.662,22860],
  [2014,"2014-09-27","2014-10-27","0001193125-14-383437",182795,70537,52503,39510,null,null,6122.663,45000],
  [2015,"2015-09-26","2015-10-28","0001193125-15-356351",233715,93626,71230,53394,null,11247,5793.069,35253],
  [2016,"2016-09-24","2016-10-26","0001628280-16-020309",215639,84263,60024,45687,null,12734,5500.281,29722],
  [2017,"2017-09-30","2017-11-03","0000320193-17-000070",229234,88186,61344,48351,63598,12451,5251.692,32900],
  [2018,"2018-09-29","2018-11-05","0000320193-18-000145",265595,101839,70898,59531,77434,13313,5000.109,72738],
  [2019,"2019-09-28","2019-10-31","0000320193-19-000119",260174,98392,63930,55256,69391,10495,4648.913,66897],
  [2020,"2020-09-26","2020-10-30","0000320193-20-000096",274515,104956,66288,57411,80674,7309,17528.214,72358],
  [2021,"2021-09-25","2021-10-29","0000320193-21-000105",365817,152836,108949,94680,104038,11085,16864.919,85971],
  [2022,"2022-09-24","2022-10-28","0000320193-22-000108",394328,170782,119437,99803,122151,10708,16325.819,89402],
  [2023,"2023-09-30","2023-11-03","0000320193-23-000106",383285,169148,114301,96995,110543,10959,15812.547,77550],
  [2024,"2024-09-28","2024-11-01","0000320193-24-000123",391035,180683,123216,93736,118254,9447,15408.095,94949],
  [2025,"2025-09-27","2025-10-31","0000320193-25-000079",416161,195201,133050,112010,111482,12715,15004.697,90711],
];

const concepts: Partial<Record<MetricKey, string>> = {
  revenue: "RevenueFromContractWithCustomerExcludingAssessedTax / SalesRevenueNet",
  grossProfit: "GrossProfit",
  operatingIncome: "OperatingIncomeLoss",
  netIncome: "NetIncomeLoss",
  operatingCashFlow: "NetCashProvidedByUsedInOperatingActivities",
  capitalExpenditures: "PaymentsToAcquirePropertyPlantAndEquipment",
  dilutedShares: "WeightedAverageNumberOfDilutedSharesOutstanding",
  shareRepurchases: "PaymentsForRepurchaseOfCommonStock",
};

function fact(metric: MetricKey, valueMillions: number | null, row: Row): NormalizedFact | undefined {
  if (valueMillions == null) return undefined;
  const [fy, end, filed, accession] = row;
  const isShares = metric === "dilutedShares";
  return {
    metric,
    value: valueMillions * 1e6,
    currency: "USD",
    unit: isShares ? "shares" : "currency",
    periodEnd: end,
    periodicity: "annual",
    fiscalYear: fy,
    provenance: {
      provider: "SEC",
      sourceUrl: `https://www.sec.gov/Archives/edgar/data/320193/${accession.replaceAll("-", "")}/`,
      accession,
      filingDate: filed,
      retrievedAt,
      concept: concepts[metric] ?? metric,
      status: "reported",
      note: "Offline fixture from SEC Company Facts; latest 10-K fact selected for the fiscal year.",
    },
  };
}

const periods: FinancialPeriod[] = rows.map((row) => {
  const [fiscalYear, periodEnd, filingDate, accession, revenue, gross, operating, net, ocf, capex, shares, buybacks] = row;
  const facts: FinancialPeriod["facts"] = {};
  for (const [key, value] of Object.entries({ revenue, grossProfit: gross, operatingIncome: operating, netIncome: net, operatingCashFlow: ocf, capitalExpenditures: capex, dilutedShares: shares, shareRepurchases: buybacks })) {
    const normalized = fact(key as MetricKey, value, row);
    if (normalized) facts[key as MetricKey] = normalized;
  }
  return { label: `FY ${fiscalYear}`, fiscalYear, periodEnd, periodicity: "annual", filingDate, accession, currency: "USD", facts };
});

// Looked up by ticker, never by position: the rows below are Apple filings
// (CIK 0000320193), and an index into the watchlist silently paired them with
// whichever company happened to sit first in it.
const APPLE = COMPANIES.find((company) => company.ticker === "AAPL")!;

export const APPLE_DATASET: CompanyDataset = {
  company: APPLE,
  periods,
  retrievedAt,
  warnings: [
    "SEC XBRL starts in 2009 for this fixture; older filing documents need a separate legacy parser.",
    "Missing facts are shown as unavailable and never interpolated.",
    "The 2020 four-for-one stock split creates a break in raw diluted-share series; per-share comparisons should use split-adjusted filing values.",
  ],
};
