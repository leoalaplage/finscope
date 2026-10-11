/**
 * The S&P 500 in the eleven sectors a market map is read in.
 *
 * The screener files each member under one of some forty labels drawn from
 * its filings — "Semiconductors", "Insurance", "Instruments" — which are closer
 * to industries, and a few of which hold companies from quite different parts
 * of the market: "Instruments" holds KLA, Northrop Grumman and Thermo Fisher.
 * A heat map grouped by them would scatter technology across five corners. So
 * each label maps to the sector most of its members belong to, and the members
 * that belong elsewhere are named, with the industry they are drawn under.
 *
 * Sector names follow the eleven most market maps use; industry names are the
 * screener's label unless the member is moved.
 */

export const SECTORS = [
  "Technology", "Financial", "Healthcare", "Consumer Cyclical", "Communication Services", "Industrials",
  "Consumer Defensive", "Energy", "Utilities", "Real Estate", "Basic Materials",
] as const;
export type Sector = (typeof SECTORS)[number];

const BY_LABEL: Record<string, Sector> = {
  "Advertising": "Communication Services",
  "Aerospace & defence": "Industrials",
  "Agriculture": "Basic Materials",
  "Airlines": "Industrials",
  "Apparel": "Consumer Cyclical",
  "Automotive": "Consumer Cyclical",
  "Banking": "Financial",
  "Biotechnology": "Healthcare",
  "Business services": "Industrials",
  "Capital markets": "Financial",
  "Chemicals": "Basic Materials",
  "Communication": "Communication Services",
  "Communication services": "Communication Services",
  "Construction": "Consumer Cyclical",
  "Consumer": "Consumer Cyclical",
  "Consumer goods": "Consumer Defensive",
  "Distribution": "Industrials",
  "Electronics": "Industrials",
  "Energy": "Energy",
  "Entertainment": "Communication Services",
  "Food & beverage": "Consumer Defensive",
  "Healthcare": "Healthcare",
  "Holding company": "Financial",
  "Hospitality": "Consumer Cyclical",
  "Industrials": "Industrials",
  "Instruments": "Technology",
  "Insurance": "Financial",
  "Materials": "Basic Materials",
  "Media": "Communication Services",
  "Medical devices": "Healthcare",
  "Mining": "Basic Materials",
  "Networking": "Technology",
  "Payments": "Financial",
  "Pharmaceuticals": "Healthcare",
  "Professional services": "Industrials",
  "Real estate": "Real Estate",
  "Restaurants": "Consumer Cyclical",
  "Retail": "Consumer Cyclical",
  "Semiconductors": "Technology",
  "Software": "Technology",
  "Technology": "Technology",
  "Telecom": "Communication Services",
  "Tobacco": "Consumer Defensive",
  "Transportation": "Industrials",
  "Travel": "Consumer Cyclical",
  "Utilities": "Utilities",
};

/** Members filed under a label whose sector is not theirs: [sector, industry]. */
const MOVED: Record<string, [Sector, string]> = {
  // Business services
  ABNB: ["Consumer Cyclical", "Travel"], ACN: ["Technology", "IT services"], AKAM: ["Technology", "Software"],
  BR: ["Technology", "IT services"], CPAY: ["Technology", "Software"], CSGP: ["Real Estate", "Real estate services"],
  DASH: ["Communication Services", "Internet content"], EBAY: ["Consumer Cyclical", "Internet retail"],
  FICO: ["Technology", "Software"], FIS: ["Technology", "IT services"], FISV: ["Technology", "IT services"],
  MCO: ["Financial", "Financial data"], MSCI: ["Financial", "Financial data"], PYPL: ["Financial", "Payments"],
  ROL: ["Consumer Cyclical", "Personal services"], SPGI: ["Financial", "Financial data"], UBER: ["Technology", "Software"],
  // Apparel, automotive
  CTAS: ["Industrials", "Business services"], PCAR: ["Industrials", "Machinery"],
  // Construction: builders stay cyclical, contractors are industrial
  DHI: ["Consumer Cyclical", "Homebuilders"], LEN: ["Consumer Cyclical", "Homebuilders"], NVR: ["Consumer Cyclical", "Homebuilders"],
  PHM: ["Consumer Cyclical", "Homebuilders"], EME: ["Industrials", "Engineering & construction"],
  FIX: ["Industrials", "Engineering & construction"], J: ["Industrials", "Engineering & construction"],
  PWR: ["Industrials", "Engineering & construction"],
  // Consumer goods
  AMCR: ["Consumer Cyclical", "Packaging"], ECL: ["Basic Materials", "Chemicals"], HAS: ["Consumer Cyclical", "Leisure"],
  // Distribution
  CAH: ["Healthcare", "Medical distribution"], COR: ["Healthcare", "Medical distribution"], MCK: ["Healthcare", "Medical distribution"],
  HSIC: ["Healthcare", "Medical distribution"], DPZ: ["Consumer Cyclical", "Restaurants"], GPC: ["Consumer Cyclical", "Auto parts"],
  SYY: ["Consumer Defensive", "Food distribution"], TEL: ["Technology", "Electronic components"],
  // Electronics
  APH: ["Technology", "Electronic components"], FLEX: ["Technology", "Electronic components"], JBL: ["Technology", "Electronic components"],
  // Holding companies
  TPL: ["Energy", "Oil & gas"],
  // Industrials
  HPE: ["Technology", "Hardware"], HPQ: ["Technology", "Hardware"], IBM: ["Technology", "IT services"], ZBRA: ["Technology", "Hardware"],
  BALL: ["Consumer Cyclical", "Packaging"], BKR: ["Energy", "Oil & gas equipment"],
  // Instruments
  A: ["Healthcare", "Diagnostics & research"], DHR: ["Healthcare", "Diagnostics & research"], MTD: ["Healthcare", "Diagnostics & research"],
  RVTY: ["Healthcare", "Diagnostics & research"], TMO: ["Healthcare", "Diagnostics & research"], WAT: ["Healthcare", "Diagnostics & research"],
  AME: ["Industrials", "Machinery"], FTV: ["Industrials", "Machinery"], ROK: ["Industrials", "Machinery"], TT: ["Industrials", "Building products"],
  VLTO: ["Industrials", "Pollution control"], LHX: ["Industrials", "Aerospace & defence"], NOC: ["Industrials", "Aerospace & defence"],
  KLAC: ["Technology", "Semiconductors"], TER: ["Technology", "Semiconductors"], ROP: ["Technology", "Software"],
  // Insurance: health plans
  CI: ["Healthcare", "Health plans"], CNC: ["Healthcare", "Health plans"], ELV: ["Healthcare", "Health plans"],
  HUM: ["Healthcare", "Health plans"], UNH: ["Healthcare", "Health plans"],
  // Materials
  DECK: ["Consumer Cyclical", "Footwear"], NKE: ["Consumer Cyclical", "Footwear"], TPR: ["Consumer Cyclical", "Luxury goods"],
  GLW: ["Technology", "Electronic components"], HWM: ["Industrials", "Aerospace & defence"], KMB: ["Consumer Defensive", "Household products"],
  AVY: ["Consumer Cyclical", "Packaging"], IP: ["Consumer Cyclical", "Packaging"], PKG: ["Consumer Cyclical", "Packaging"],
  SW: ["Consumer Cyclical", "Packaging"],
  // Medical devices
  MMM: ["Industrials", "Conglomerates"],
  // Professional services
  IT: ["Technology", "IT services"],
  // Retail
  COST: ["Consumer Defensive", "Discount stores"], WMT: ["Consumer Defensive", "Discount stores"], TGT: ["Consumer Defensive", "Discount stores"],
  DG: ["Consumer Defensive", "Discount stores"], DLTR: ["Consumer Defensive", "Discount stores"], KR: ["Consumer Defensive", "Grocery"],
  CASY: ["Consumer Defensive", "Grocery"], CDW: ["Technology", "IT services"], CPRT: ["Industrials", "Business services"],
  CVS: ["Healthcare", "Health plans"], FAST: ["Industrials", "Distribution"], SHW: ["Basic Materials", "Chemicals"],
  BLDR: ["Industrials", "Building products"],
  // Software
  TTWO: ["Communication Services", "Gaming"],
  // Technology
  ADP: ["Industrials", "Business services"], VRSK: ["Industrials", "Business services"], RDDT: ["Communication Services", "Internet content"],
  FDS: ["Financial", "Financial data"],
  // Transportation and travel
  CCL: ["Consumer Cyclical", "Travel"], NCLH: ["Consumer Cyclical", "Travel"], RCL: ["Consumer Cyclical", "Travel"],
  CHRW: ["Industrials", "Logistics"], EXPD: ["Industrials", "Logistics"],
  // Utilities: pipelines and waste
  KMI: ["Energy", "Midstream"], OKE: ["Energy", "Midstream"], TRGP: ["Energy", "Midstream"], WMB: ["Energy", "Midstream"],
  RSG: ["Industrials", "Waste management"], WM: ["Industrials", "Waste management"],
};

/** Labels that name a business model better under another word. */
const INDUSTRY_NAME: Record<string, string> = {
  "Communication": "Internet content", "Communication services": "Internet content",
  "Consumer": "Internet retail", "Holding company": "Conglomerates",
};

/** A member's sector and industry, from the screener's label and the list above. */
export function classify(ticker: string, label: string | null | undefined): { sector: Sector; industry: string } {
  const moved = MOVED[ticker];
  if (moved) return { sector: moved[0], industry: moved[1] };
  const known = label && label !== "Unclassified" ? label : null;
  return { sector: (known && BY_LABEL[known]) || "Industrials", industry: known ? INDUSTRY_NAME[known] ?? known : "Other" };
}
