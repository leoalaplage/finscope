/**
 * The statements, in reading order.
 *
 * One list per statement, each following the order the statement itself is
 * filed in, so a reader scanning the table finds revenue above cost above gross
 * profit rather than an alphabetised inventory of concepts.
 *
 * Kept in its own module, with no imports, for two reasons. It is the shape of
 * the page rather than anything about a company, so it has no business
 * travelling inside a company's payload — where it was cached for a day and a
 * new section stayed invisible for as long. And a client component can read it
 * here without dragging the projection engine into the browser bundle.
 */
export const IO_SECTIONS: Array<{ id: string; label: string; metrics: string[] }> = [
  {
    id: "income",
    label: "Income statement",
    metrics: [
      "revenue", "costOfRevenue", "grossProfit", "researchAndDevelopment",
      "sellingGeneralAndAdministrative", "operatingExpenses", "operatingIncome",
      "ebitda", "interestExpense", "otherIncomeExpense", "incomeBeforeTax",
      "incomeTaxExpense", "netIncome", "netIncomePerShare", "dilutedShares", "basicShares",
    ],
  },
  {
    /*
     * Per share, on its own, because it is the half of the story a total hides.
     *
     * A business whose free cash flow grew by half over five years while its
     * share count grew by more has not made its owners better off, and the
     * cash-flow statement will never say so. The figure after stock-based
     * compensation is the one FinScope is built around: options are a cost paid
     * in ownership, and free cash flow that does not carry them is free cash
     * flow somebody else was paid out of.
     */
    id: "pershare",
    label: "Per share",
    metrics: [
      "revenuePerShare", "grossProfitPerShare", "operatingIncomePerShare",
      "netIncomePerShare", "operatingCashFlowPerShare", "freeCashFlowPerShare",
      "freeCashFlowAfterSbcPerShare", "dividendsPerShare",
    ],
  },
  {
    id: "balance",
    label: "Balance sheet",
    metrics: [
      "cashAndEquivalents", "shortTermInvestments", "accountsReceivable", "inventory",
      "currentAssets", "propertyPlantAndEquipment", "goodwill", "intangibleAssets",
      "longTermInvestments", "totalAssets", "accountsPayable", "currentLiabilities",
      "totalDebt", "totalLiabilities", "retainedEarnings", "totalEquity", "netDebt",
      "sharesOutstanding",
    ],
  },
  {
    id: "cashflow",
    label: "Cash flow",
    metrics: [
      "operatingCashFlow", "depreciationAndAmortization", "stockBasedCompensation",
      "capitalExpenditures", "freeCashFlow", "freeCashFlowAfterSbc",
      "acquisitions", "shareRepurchases", "shareIssuance", "netShareRepurchases",
      "dividendsPaid",
    ],
  },
  {
    id: "ratios",
    label: "Margins and returns",
    metrics: [
      "grossMargin", "operatingMargin", "ebitdaMargin", "netMargin",
      "operatingCashFlowMargin", "freeCashFlowMargin", "freeCashFlowAfterSbcMargin",
      "cashConversion", "roic", "cashReturnOnCapital", "returnOnEquity",
      "returnOnAssets", "returnOnCapitalEmployed", "capitalIntensity",
      "effectiveTaxRate", "dividendPayout", "debtToEquity", "interestCoverage",
    ],
  },
];
