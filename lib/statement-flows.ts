import { derivedValue, valueOf } from "./finance";
import type { FinancialPeriod, MetricKey } from "./types";
import type { SankeyFlow } from "./sankey";

export interface StatementNode { id: string; label: string; tone: "revenue" | "profit" | "cost" | "asset" | "liability" | "equity" | "neutral" }

export interface StatementDiagram {
  flows: SankeyFlow[];
  nodes: StatementNode[];
  /** Reported values keyed by node, for labels and the tooltip. */
  values: Record<string, number>;
  /** Anything the filing does not let the diagram state exactly. */
  notes: string[];
  currency: string;
  periodLabel: string;
  periodEnd: string;
}

const positive = (value: number | null | undefined) => value != null && Number.isFinite(value) && value > 0 ? value : 0;

/**
 * A residual bucket, only when it is real.
 *
 * A statement diagram must add up: if the identified components already exceed
 * the total, the difference is negative and drawing it would invent a flow.
 * Below a thousandth of the total it is rounding, not a line item.
 */
function residual(total: number, parts: number[], threshold = .001) {
  const rest = total - parts.reduce((sum, value) => sum + value, 0);
  if (rest <= 0 || rest < total * threshold) return 0;
  return rest;
}

/**
 * Where a year's revenue went.
 *
 * Three stages: revenue splits into cost of sales and gross profit, gross
 * profit splits into operating costs and operating income, and operating income
 * splits into tax and what is left for shareholders.
 *
 * Non-operating items are the awkward case. When they are a net cost the
 * diagram absorbs them into a labelled bucket; when they are a net gain they
 * are not a slice of operating income at all, so they enter as their own source
 * rather than being netted silently against something else.
 */
export function incomeStatementDiagram(period: FinancialPeriod): StatementDiagram | null {
  const value = (metric: MetricKey) => valueOf(period, metric);
  const revenue = positive(value("revenue"));
  if (!revenue) return null;

  const notes: string[] = [];
  const grossProfit = positive(value("grossProfit"));
  const costOfRevenue = positive(value("costOfRevenue")) || (grossProfit ? revenue - grossProfit : 0);
  const operatingIncome = positive(value("operatingIncome"));
  const netIncome = positive(value("netIncome"));
  const tax = positive(value("incomeTaxExpense"));
  const research = positive(value("researchAndDevelopment"));
  const selling = positive(value("sellingGeneralAndAdministrative"));

  const nodes: StatementNode[] = [{ id: "revenue", label: "Revenue", tone: "revenue" }];
  const flows: SankeyFlow[] = [];
  const values: Record<string, number> = { revenue };

  if (!grossProfit) {
    notes.push("The filer reports no gross profit, so revenue is shown against operating costs directly.");
  }
  const profitAfterCost = grossProfit || Math.max(0, revenue - costOfRevenue);
  if (costOfRevenue > 0) {
    nodes.push({ id: "costOfRevenue", label: "Cost of revenue", tone: "cost" });
    flows.push({ source: "revenue", target: "costOfRevenue", value: costOfRevenue });
    values.costOfRevenue = costOfRevenue;
  }
  if (profitAfterCost <= 0) return null;
  nodes.push({ id: "grossProfit", label: grossProfit ? "Gross profit" : "Revenue less cost", tone: "profit" });
  flows.push({ source: "revenue", target: "grossProfit", value: profitAfterCost });
  values.grossProfit = profitAfterCost;

  // Operating costs, named where the filer names them.
  const namedOpex = [
    research > 0 ? { id: "researchAndDevelopment", label: "R&D", amount: research } : null,
    selling > 0 ? { id: "sellingGeneralAndAdministrative", label: "SG&A", amount: selling } : null,
  ].filter((item): item is { id: string; label: string; amount: number } => item !== null);

  const totalOpex = operatingIncome > 0 ? Math.max(0, profitAfterCost - operatingIncome) : 0;
  for (const item of namedOpex) {
    if (item.amount >= totalOpex && totalOpex > 0) continue;
    nodes.push({ id: item.id, label: item.label, tone: "cost" });
    flows.push({ source: "grossProfit", target: item.id, value: item.amount });
    values[item.id] = item.amount;
  }
  const drawnOpex = namedOpex.filter((item) => values[item.id] != null).map((item) => item.amount);
  const otherOpex = residual(totalOpex, drawnOpex);
  if (otherOpex > 0) {
    nodes.push({ id: "otherOperating", label: "Other operating", tone: "cost" });
    flows.push({ source: "grossProfit", target: "otherOperating", value: otherOpex });
    values.otherOperating = otherOpex;
  }

  // Many filers publish no OperatingIncomeLoss at all — Zoetis and Interactive
  // Brokers among them. Stopping there left their diagrams three boxes wide.
  // Pre-tax income is recoverable without it, as net income plus the tax paid
  // on it, so the remaining operating costs become the balancing item instead.
  const feedsPretax = operatingIncome > 0 ? "operatingIncome" : "grossProfit";
  if (operatingIncome > 0) {
    nodes.push({ id: "operatingIncome", label: "Operating income", tone: "profit" });
    flows.push({ source: "grossProfit", target: "operatingIncome", value: operatingIncome });
    values.operatingIncome = operatingIncome;
  } else if (netIncome > 0) {
    const impliedPretax = netIncome + tax;
    const unnamed = residual(profitAfterCost, [...drawnOpex, impliedPretax]);
    if (unnamed > 0) {
      nodes.push({ id: "unallocatedOperating", label: "Other operating", tone: "cost" });
      flows.push({ source: "grossProfit", target: "unallocatedOperating", value: unnamed });
      values.unallocatedOperating = unnamed;
    }
    notes.push("The filer tags no operating income, so pre-tax income is taken as net income plus tax and the remaining costs are grouped.");
  } else {
    notes.push("Neither operating income nor net income is positive in this period, so the diagram stops at gross profit.");
    return { flows, nodes, values, notes, currency: period.currency, periodLabel: period.label, periodEnd: period.periodEnd };
  }

  // The identity below is: profit before non-operating items, plus net
  // non-operating income, less tax, equals net income. Solving for the
  // non-operating term rather than trusting a separately tagged one is what
  // makes the diagram close on every filer.
  const upstream = operatingIncome > 0 ? operatingIncome : netIncome + tax;
  const nonOperating = netIncome > 0 ? netIncome + tax - upstream : 0;
  const pool = upstream + Math.max(0, nonOperating);
  if (nonOperating > 0) {
    nodes.push({ id: "otherIncome", label: "Other income", tone: "revenue" });
    flows.push({ source: "otherIncome", target: "pretax", value: nonOperating });
    values.otherIncome = nonOperating;
  }
  nodes.push({ id: "pretax", label: "Pre-tax income", tone: "profit" });
  flows.push({ source: feedsPretax, target: "pretax", value: upstream });
  values.pretax = pool;

  if (nonOperating < 0) {
    const cost = Math.min(pool, -nonOperating);
    nodes.push({ id: "otherCost", label: "Interest & other", tone: "cost" });
    flows.push({ source: "pretax", target: "otherCost", value: cost });
    values.otherCost = cost;
  }
  if (tax > 0) {
    nodes.push({ id: "tax", label: "Tax", tone: "cost" });
    flows.push({ source: "pretax", target: "tax", value: Math.min(tax, pool) });
    values.tax = tax;
  }
  if (netIncome > 0) {
    nodes.push({ id: "netIncome", label: "Net income", tone: "profit" });
    flows.push({ source: "pretax", target: "netIncome", value: netIncome });
    values.netIncome = netIncome;
  } else {
    notes.push("Net income is not positive in this period, so no profit flow is drawn.");
  }

  return { flows, nodes, values, notes, currency: period.currency, periodLabel: period.label, periodEnd: period.periodEnd };
}

/**
 * What the company owns against who has a claim on it.
 *
 * Assets flow in from the left, gather at the balance-sheet total, and flow out
 * to liabilities and equity — which is the accounting identity drawn rather
 * than asserted. Anything the filer does not itemise becomes a labelled "other"
 * bucket; nothing is inferred beyond subtraction from a reported total.
 */
export function balanceSheetDiagram(period: FinancialPeriod): StatementDiagram | null {
  const value = (metric: MetricKey) => valueOf(period, metric);
  const totalAssets = positive(value("totalAssets"));
  if (!totalAssets) return null;

  const notes: string[] = [];
  const nodes: StatementNode[] = [];
  const flows: SankeyFlow[] = [];
  const values: Record<string, number> = { totalAssets };

  const assetParts = [
    { id: "cashAndEquivalents", label: "Cash", amount: positive(value("cashAndEquivalents")) },
    { id: "shortTermInvestments", label: "ST investments", amount: positive(value("shortTermInvestments")) },
    { id: "accountsReceivable", label: "Receivables", amount: positive(value("accountsReceivable")) },
    { id: "inventory", label: "Inventory", amount: positive(value("inventory")) },
    { id: "propertyPlantAndEquipment", label: "PP&E", amount: positive(value("propertyPlantAndEquipment")) },
    { id: "longTermInvestments", label: "LT investments", amount: positive(value("longTermInvestments")) },
    { id: "goodwill", label: "Goodwill", amount: positive(value("goodwill")) },
    { id: "intangibleAssets", label: "Intangibles", amount: positive(value("intangibleAssets")) },
  ].filter((item) => item.amount > 0);

  const identified = assetParts.reduce((sum, item) => sum + item.amount, 0);
  if (identified > totalAssets) {
    notes.push("The itemised assets add to more than the reported total, so the breakdown is scaled to fit and the components should be read with care.");
  }
  const factor = identified > totalAssets ? totalAssets / identified : 1;
  for (const item of assetParts) {
    nodes.push({ id: item.id, label: item.label, tone: "asset" });
    flows.push({ source: item.id, target: "totalAssets", value: item.amount * factor });
    values[item.id] = item.amount;
  }
  const otherAssets = residual(totalAssets, assetParts.map((item) => item.amount * factor));
  if (otherAssets > 0) {
    nodes.push({ id: "otherAssets", label: "Other assets", tone: "asset" });
    flows.push({ source: "otherAssets", target: "totalAssets", value: otherAssets });
    values.otherAssets = otherAssets;
  }
  nodes.push({ id: "totalAssets", label: "Total assets", tone: "neutral" });

  const equity = positive(value("totalEquity"));
  const reportedLiabilities = positive(value("totalLiabilities"));
  const liabilities = reportedLiabilities || Math.max(0, totalAssets - equity);
  if (!reportedLiabilities && equity > 0) {
    notes.push("The filer reports no total liabilities, so it is taken as total assets less equity.");
  }

  if (liabilities > 0) {
    nodes.push({ id: "totalLiabilities", label: "Liabilities", tone: "liability" });
    flows.push({ source: "totalAssets", target: "totalLiabilities", value: Math.min(liabilities, totalAssets) });
    values.totalLiabilities = liabilities;

    const liabilityParts = [
      { id: "accountsPayable", label: "Payables", amount: positive(value("accountsPayable")) },
      { id: "totalDebt", label: "Debt", amount: positive(value("totalDebt")) },
    ].filter((item) => item.amount > 0 && item.amount < liabilities);
    for (const item of liabilityParts) {
      nodes.push({ id: item.id, label: item.label, tone: "liability" });
      flows.push({ source: "totalLiabilities", target: item.id, value: item.amount });
      values[item.id] = item.amount;
    }
    const otherLiabilities = residual(liabilities, liabilityParts.map((item) => item.amount));
    if (otherLiabilities > 0) {
      nodes.push({ id: "otherLiabilities", label: "Other liabilities", tone: "liability" });
      flows.push({ source: "totalLiabilities", target: "otherLiabilities", value: otherLiabilities });
      values.otherLiabilities = otherLiabilities;
    }
  }

  if (equity > 0) {
    nodes.push({ id: "totalEquity", label: "Equity", tone: "equity" });
    flows.push({ source: "totalAssets", target: "totalEquity", value: Math.min(equity, totalAssets) });
    values.totalEquity = equity;
    const retained = value("retainedEarnings");
    if (retained != null && retained > 0 && retained < equity) {
      nodes.push({ id: "retainedEarnings", label: "Retained earnings", tone: "equity" });
      flows.push({ source: "totalEquity", target: "retainedEarnings", value: retained });
      values.retainedEarnings = retained;
      const paidIn = residual(equity, [retained]);
      if (paidIn > 0) {
        nodes.push({ id: "paidInCapital", label: "Paid-in & other", tone: "equity" });
        flows.push({ source: "totalEquity", target: "paidInCapital", value: paidIn });
        values.paidInCapital = paidIn;
      }
    } else if (retained != null && retained < 0) {
      notes.push(`Retained earnings are negative (${retained.toLocaleString("en-US", { style: "currency", currency: period.currency, notation: "compact" })}): the company has distributed more than it has ever earned, so equity is not split.`);
    }
  } else {
    notes.push("Equity is not positive in this period, so the claims side is shown as liabilities only.");
  }

  // Assets equal liabilities plus equity — but "equity" here is the parent's
  // share, and a group with minority partners has a third claim on the same
  // assets. S&P Global's balance sheet was 8% short and Interactive Brokers' 7%
  // until this was drawn: IBKR's public company owns barely a quarter of the
  // operating group, so most of its balance sheet belongs to someone else.
  const otherClaims = residual(totalAssets, [Math.min(liabilities, totalAssets), Math.min(Math.max(equity, 0), totalAssets)]);
  if (otherClaims > 0) {
    nodes.push({ id: "otherClaims", label: "Minority & other", tone: "equity" });
    flows.push({ source: "totalAssets", target: "otherClaims", value: otherClaims });
    values.otherClaims = otherClaims;
  }

  return { flows, nodes, values, notes, currency: period.currency, periodLabel: period.label, periodEnd: period.periodEnd };
}

/**
 * How much of the year's profit arrived as cash, and what was left of it.
 *
 * Net income is an accounting result; free cash flow is what the business could
 * actually hand to its owners, and the gap between the two is the reason both
 * are reported. Three stages: profit plus the charges that never cost cash
 * becomes operating cash flow, operating cash flow less the spending needed to
 * stay in business becomes free cash flow, and free cash flow splits between
 * what was returned to shareholders and what was kept.
 *
 * Nothing here is modelled. Free cash flow is the same figure the rest of the
 * application computes, and every other ribbon is a filed line or a subtraction
 * from one.
 */
export function cashFlowDiagram(period: FinancialPeriod): StatementDiagram | null {
  const value = (metric: MetricKey) => valueOf(period, metric);
  const operating = positive(value("operatingCashFlow"));
  if (!operating) return null;

  const notes: string[] = [];
  const nodes: StatementNode[] = [];
  const flows: SankeyFlow[] = [];
  const values: Record<string, number> = { operatingCashFlow: operating };
  const netIncome = positive(value("netIncome"));

  if (netIncome > 0) {
    nodes.push({ id: "netIncome", label: "Net income", tone: "profit" });
    flows.push({ source: "netIncome", target: "operatingCashFlow", value: Math.min(netIncome, operating) });
    values.netIncome = netIncome;
  } else {
    notes.push("Net income is not positive in this period, so operating cash flow is shown without the profit it is built from.");
  }

  // The bridge between profit and cash: depreciation and share-based pay are
  // charged against earnings without leaving the company, and working capital
  // moves the balance either way.
  const bridge = netIncome > 0 ? operating - netIncome : 0;
  if (bridge > 0) {
    const addBacks = [
      { id: "depreciationAndAmortization", label: "D&A", amount: positive(value("depreciationAndAmortization")) },
      { id: "stockBasedCompensation", label: "SBC", amount: positive(value("stockBasedCompensation")) },
    ].filter((item) => item.amount > 0);
    const named = addBacks.reduce((total, item) => total + item.amount, 0);
    // Naming the add-backs only works while they fit inside the bridge. When
    // they add to more than it, working capital consumed the difference and
    // drawing them separately would need a matching outflow the filing does not
    // itemise — so the whole bridge is drawn as one honest line instead.
    if (named > 0 && named <= bridge) {
      for (const item of addBacks) {
        nodes.push({ id: item.id, label: item.label, tone: "revenue" });
        flows.push({ source: item.id, target: "operatingCashFlow", value: item.amount });
        values[item.id] = item.amount;
      }
      const rest = residual(bridge, addBacks.map((item) => item.amount));
      if (rest > 0) {
        nodes.push({ id: "otherNonCash", label: "Other non-cash", tone: "revenue" });
        flows.push({ source: "otherNonCash", target: "operatingCashFlow", value: rest });
        values.otherNonCash = rest;
      }
    } else {
      nodes.push({ id: "nonCashAndWorkingCapital", label: "Non-cash & working capital", tone: "revenue" });
      flows.push({ source: "nonCashAndWorkingCapital", target: "operatingCashFlow", value: bridge });
      values.nonCashAndWorkingCapital = bridge;
      if (named > bridge) {
        notes.push("Depreciation and share-based pay add back more than the gap between profit and operating cash flow, so working capital consumed the difference; the additions are drawn as one line rather than split.");
      }
    }
  } else if (netIncome > operating) {
    const consumed = netIncome - operating;
    nodes.push({ id: "cashConsumed", label: "Non-cash gains & working capital", tone: "cost" });
    flows.push({ source: "netIncome", target: "cashConsumed", value: consumed });
    values.cashConsumed = consumed;
  }

  nodes.push({ id: "operatingCashFlow", label: "Operating cash flow", tone: "profit" });

  const freeCashFlow = derivedValue(period, "freeCashFlow");
  if (freeCashFlow == null) {
    notes.push("The filer tags no capital expenditure, so free cash flow cannot be separated from operating cash flow.");
    return { flows, nodes, values, notes, currency: period.currency, periodLabel: period.label, periodEnd: period.periodEnd };
  }

  const capex = Math.max(0, operating - freeCashFlow);
  if (capex > 0) {
    nodes.push({ id: "capitalExpenditures", label: "Capex", tone: "cost" });
    flows.push({ source: "operatingCashFlow", target: "capitalExpenditures", value: Math.min(capex, operating) });
    values.capitalExpenditures = capex;
  }
  if (freeCashFlow <= 0) {
    notes.push("Capital expenditure exceeded operating cash flow in this period, so there is no free cash flow to draw.");
    return { flows, nodes, values, notes, currency: period.currency, periodLabel: period.label, periodEnd: period.periodEnd };
  }
  nodes.push({ id: "freeCashFlow", label: "Free cash flow", tone: "profit" });
  flows.push({ source: "operatingCashFlow", target: "freeCashFlow", value: freeCashFlow });
  values.freeCashFlow = freeCashFlow;

  // Where the free cash flow went. A company can return more than it earned in
  // a year by drawing on its balance sheet or borrowing, so the ribbons are
  // scaled to what there was and the excess is stated rather than drawn.
  const returns = [
    { id: "dividendsPaid", label: "Dividends", amount: positive(value("dividendsPaid")) },
    { id: "shareRepurchases", label: "Buybacks", amount: positive(value("shareRepurchases")) },
  ].filter((item) => item.amount > 0);
  const returned = returns.reduce((total, item) => total + item.amount, 0);
  const factor = returned > freeCashFlow ? freeCashFlow / returned : 1;
  if (returned > freeCashFlow) {
    notes.push(`Dividends and buybacks came to ${(returned / freeCashFlow).toFixed(2)}× the year's free cash flow: the difference came from cash already held or from borrowing, so the ribbons are scaled to the cash the year produced.`);
  }
  for (const item of returns) {
    nodes.push({ id: item.id, label: item.label, tone: "equity" });
    flows.push({ source: "freeCashFlow", target: item.id, value: item.amount * factor });
    values[item.id] = item.amount;
  }
  const retained = residual(freeCashFlow, returns.map((item) => item.amount * factor));
  if (retained > 0) {
    nodes.push({ id: "retainedCash", label: "Kept in the business", tone: "neutral" });
    flows.push({ source: "freeCashFlow", target: "retainedCash", value: retained });
    values.retainedCash = retained;
  }

  return { flows, nodes, values, notes, currency: period.currency, periodLabel: period.label, periodEnd: period.periodEnd };
}

export interface BalanceSheetHealth {
  label: string;
  key: string;
  value: number | null;
  format: "ratio" | "percent" | "currency" | "years";
  hint: string;
  reason?: string;
}

/**
 * The balance-sheet questions worth asking of a quality compounder: can it pay
 * what is due within the year, how much of the business is borrowed, how long
 * the debt would take to repay out of cash flow, and how much of the asset base
 * is goodwill from past deals rather than something it operates.
 */
export function balanceSheetHealth(period: FinancialPeriod): BalanceSheetHealth[] {
  const value = (metric: MetricKey) => valueOf(period, metric);
  const currentAssets = value("currentAssets"); const currentLiabilities = value("currentLiabilities");
  const cash = value("cashAndEquivalents") ?? 0; const shortTerm = value("shortTermInvestments") ?? 0;
  const receivables = value("accountsReceivable") ?? 0;
  const totalAssets = value("totalAssets"); const goodwill = value("goodwill"); const intangibles = value("intangibleAssets");
  const ebitda = derivedValue(period, "ebitda");
  const netDebt = derivedValue(period, "netDebt");
  const freeCashFlow = derivedValue(period, "freeCashFlow");
  const divide = (a: number | null, b: number | null) => a == null || b == null || b === 0 ? null : a / b;

  return [
    { key: "currentRatio", label: "Current ratio", value: divide(currentAssets, currentLiabilities), format: "ratio",
      hint: "Current assets over current liabilities. Below 1 means the next year's bills exceed the assets earmarked to pay them.",
      reason: currentAssets == null || currentLiabilities == null ? "The filer reports no current split" : undefined },
    { key: "quickRatio", label: "Quick ratio", value: divide(cash + shortTerm + receivables || null, currentLiabilities), format: "ratio",
      hint: "The same, counting only cash, near-cash and money already owed to the company — inventory excluded.",
      reason: currentLiabilities == null ? "The filer reports no current liabilities" : undefined },
    { key: "netDebtToEbitda", label: "Net debt / EBITDA", value: netDebt != null && ebitda != null && ebitda > 0 ? netDebt / ebitda : null, format: "years",
      hint: "How many years of operating profit before non-cash charges the net borrowings represent. Negative means net cash.",
      reason: ebitda == null || ebitda <= 0 ? "EBITDA is not positive" : undefined },
    { key: "netDebtToFcf", label: "Net debt / FCF", value: netDebt != null && freeCashFlow != null && freeCashFlow > 0 ? netDebt / freeCashFlow : null, format: "years",
      hint: "The same question asked of actual cash rather than an accounting profit.",
      reason: freeCashFlow == null || freeCashFlow <= 0 ? "Free cash flow is not positive" : undefined },
    { key: "debtToEquity", label: "Debt / equity", value: derivedValue(period, "debtToEquity"), format: "ratio",
      hint: "Borrowings against the shareholders' own stake." },
    { key: "interestCoverage", label: "EBIT / interest", value: derivedValue(period, "interestCoverage"), format: "ratio",
      hint: "How many times over operating profit covers the interest bill.", reason: "The filer reports no interest expense" },
    { key: "goodwillShare", label: "Goodwill & intangibles / assets",
      value: totalAssets && totalAssets > 0 && (goodwill != null || intangibles != null) ? ((goodwill ?? 0) + (intangibles ?? 0)) / totalAssets : null,
      format: "percent", hint: "How much of the balance sheet is the price paid for past acquisitions rather than something the business operates.",
      reason: "The filer tags neither goodwill nor acquired intangibles" },
    { key: "equityRatio", label: "Equity / assets", value: divide(value("totalEquity"), totalAssets), format: "percent",
      hint: "The share of the asset base funded by shareholders rather than borrowed." },
  ];
}
