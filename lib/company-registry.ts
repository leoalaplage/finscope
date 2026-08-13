import type { CompanyProfile } from "./types";

const us = (profile: Omit<CompanyProfile, "currency" | "resolutionStatus" | "regulatoryId" | "businessType"> & { businessType?: CompanyProfile["businessType"] }): CompanyProfile => ({
  ...profile, currency: "USD", regulatoryId: `CIK ${profile.cik}`, resolutionStatus: "verified", businessType: profile.businessType ?? "operating",
});

/** Exact initial watchlist requested for FinScope. Order is intentional. */
export const DEFAULT_WATCHLIST: CompanyProfile[] = [
  us({ name: "NVIDIA Corporation", ticker: "NVDA", yahooTicker: "NVDA", cik: "0001045810", exchange: "NASDAQ", sector: "Semiconductors", description: "Accelerated computing platforms and software.", stockSplits: [{ date: "2021-07-20", ratio: 4 }, { date: "2024-06-10", ratio: 10 }] }),
  us({ name: "Apple Inc.", ticker: "AAPL", yahooTicker: "AAPL", cik: "0000320193", exchange: "NASDAQ", sector: "Technology", description: "Consumer technology, devices and services.", stockSplits: [{ date: "2014-06-09", ratio: 7 }, { date: "2020-08-31", ratio: 4 }] }),
  us({ name: "Alphabet Inc.", ticker: "GOOGL", yahooTicker: "GOOGL", cik: "0001652044", exchange: "NASDAQ", sector: "Communication services", description: "Search, advertising, cloud and digital platforms.", stockSplits: [{ date: "2022-07-18", ratio: 20 }] }),
  us({ name: "Microsoft Corporation", ticker: "MSFT", yahooTicker: "MSFT", cik: "0000789019", exchange: "NASDAQ", sector: "Technology", description: "Cloud software, productivity and computing." }),
  us({ name: "Meta Platforms, Inc.", ticker: "META", yahooTicker: "META", cik: "0001326801", exchange: "NASDAQ", sector: "Communication services", description: "Social platforms, digital advertising and AI." }),
  us({ name: "Visa Inc.", ticker: "V", yahooTicker: "V", cik: "0001403161", exchange: "NYSE", sector: "Payments", description: "Global electronic payments network.", stockSplits: [{ date: "2015-03-19", ratio: 4 }] }),
  us({ name: "Mastercard Incorporated", ticker: "MA", yahooTicker: "MA", cik: "0001141391", exchange: "NYSE", sector: "Payments", description: "Global payments network and data services.", stockSplits: [{ date: "2014-01-22", ratio: 10 }] }),
  us({ name: "Arista Networks, Inc.", ticker: "ANET", yahooTicker: "ANET", cik: "0001596532", exchange: "NYSE", sector: "Networking", description: "Cloud networking hardware and software.", stockSplits: [{ date: "2021-11-18", ratio: 4 }, { date: "2024-12-04", ratio: 4 }] }),
  { name: "HES Beheer N.V.", ticker: "HESA.F", yahooTicker: "HESA.F", cik: "", regulatoryId: "ISIN NL0000358125 (historical)", exchange: "Frankfurt (historical cross-listing)", currency: "EUR", sector: "Port logistics", description: "Historical HES Beheer instrument; delisted after acquisition in 2014.", businessType: "international", resolutionStatus: "unresolved", resolutionNote: "Exact Yahoo symbol HESA.F is retained. No current, reliably resolvable regulatory filing feed is available; the app must not substitute another instrument." },
  us({ name: "Booking Holdings Inc.", ticker: "BKNG", yahooTicker: "BKNG", cik: "0001075531", exchange: "NASDAQ", sector: "Travel", description: "Online travel reservation platforms.", stockSplits: [{ date: "2026-04-02", ratio: 25 }] }),
  us({ name: "ServiceNow, Inc.", ticker: "NOW", yahooTicker: "NOW", cik: "0001373715", exchange: "NYSE", sector: "Software", description: "Enterprise workflow and automation software.", stockSplits: [{ date: "2025-12-17", ratio: 5 }] }),
  us({ name: "S&P Global Inc.", ticker: "SPGI", yahooTicker: "SPGI", cik: "0000064040", exchange: "NYSE", sector: "Financial data", description: "Ratings, indices, commodity and market intelligence." }),
  us({ name: "Airbnb, Inc.", ticker: "ABNB", yahooTicker: "ABNB", cik: "0001559720", exchange: "NASDAQ", sector: "Travel", description: "Global marketplace for stays and experiences." }),
  us({ name: "CME Group Inc.", ticker: "CME", yahooTicker: "CME", cik: "0001156375", exchange: "NASDAQ", sector: "Exchanges", description: "Derivatives exchanges and clearing services.", businessType: "financial" }),
  us({ name: "Paychex, Inc.", ticker: "PAYX", yahooTicker: "PAYX", cik: "0000723531", exchange: "NASDAQ", sector: "Business services", description: "Payroll, HR and benefits services." }),
  us({ name: "Interactive Brokers Group, Inc.", ticker: "IBKR", yahooTicker: "IBKR", cik: "0001381197", exchange: "NASDAQ", sector: "Brokerage", description: "Electronic brokerage and market making.", businessType: "financial", stockSplits: [{ date: "2025-06-17", ratio: 4 }] }),
  us({ name: "MSCI Inc.", ticker: "MSCI", yahooTicker: "MSCI", cik: "0001408198", exchange: "NYSE", sector: "Financial data", description: "Indices, analytics and portfolio tools." }),
  us({ name: "Veeva Systems Inc.", ticker: "VEEV", yahooTicker: "VEEV", cik: "0001393052", exchange: "NYSE", sector: "Life-sciences software", description: "Cloud software for the life-sciences industry." }),
  us({ name: "Zoetis Inc.", ticker: "ZTS", yahooTicker: "ZTS", cik: "0001555280", exchange: "NYSE", sector: "Animal health", description: "Animal medicines, vaccines and diagnostics." }),
  us({ name: "Cboe Global Markets, Inc.", ticker: "CBOE", yahooTicker: "CBOE", cik: "0001374310", exchange: "Cboe BZX", sector: "Exchanges", description: "Options, equities and derivatives market infrastructure.", businessType: "financial" }),
  us({ name: "Copart, Inc.", ticker: "CPRT", yahooTicker: "CPRT", cik: "0000900075", exchange: "NASDAQ", sector: "Business services", description: "Online vehicle auctions and remarketing.", stockSplits: [{ date: "2012-03-29", ratio: 2 }, { date: "2017-04-11", ratio: 2 }, { date: "2022-11-03", ratio: 2 }, { date: "2023-08-22", ratio: 2 }] }),
  us({ name: "FactSet Research Systems Inc.", ticker: "FDS", yahooTicker: "FDS", cik: "0001013237", exchange: "NYSE", sector: "Financial data", description: "Financial data, analytics and workflow solutions." }),
];

export const COMPANIES = DEFAULT_WATCHLIST;

export function findCompany(query: string, companies: CompanyProfile[] = DEFAULT_WATCHLIST) {
  const needle = query.trim().toLowerCase();
  return companies.filter((company) => company.ticker.toLowerCase().includes(needle) || company.name.toLowerCase().includes(needle));
}

export function companyByTicker(ticker: string) {
  return DEFAULT_WATCHLIST.find((company) => company.ticker.toUpperCase() === ticker.toUpperCase());
}

export function addCompanyUnique(watchlist: CompanyProfile[], company: CompanyProfile) {
  return watchlist.some((item)=>item.ticker.toUpperCase()===company.ticker.toUpperCase()) ? watchlist : [...watchlist,company];
}
