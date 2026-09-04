import type { CompanyProfile } from "./types";

const us = (profile: Omit<CompanyProfile, "currency" | "resolutionStatus" | "regulatoryId" | "businessType"> & { businessType?: CompanyProfile["businessType"] }): CompanyProfile => ({
  ...profile, currency: "USD", regulatoryId: `CIK ${profile.cik}`, resolutionStatus: "verified", businessType: profile.businessType ?? "operating",
});

/**
 * The default home watchlist: the 27 largest S&P 500 securities by market
 * capitalisation at the September 2026 refresh. Order is intentional. Alphabet
 * appears twice because both listed share classes are constituents.
 */
export const DEFAULT_WATCHLIST: CompanyProfile[] = [
  us({ name: "NVIDIA Corporation", ticker: "NVDA", yahooTicker: "NVDA", cik: "0001045810", exchange: "NASDAQ", sector: "Semiconductors", description: "Accelerated computing platforms and software.", stockSplits: [{ date: "2021-07-20", ratio: 4 }, { date: "2024-06-10", ratio: 10 }] }),
  us({ name: "Apple Inc.", ticker: "AAPL", yahooTicker: "AAPL", cik: "0000320193", exchange: "NASDAQ", sector: "Technology", description: "Consumer technology, devices and services.", stockSplits: [{ date: "2014-06-09", ratio: 7 }, { date: "2020-08-31", ratio: 4 }] }),
  us({ name: "Microsoft Corporation", ticker: "MSFT", yahooTicker: "MSFT", cik: "0000789019", exchange: "NASDAQ", sector: "Technology", description: "Cloud software, productivity and computing." }),
  us({ name: "Amazon.com, Inc.", ticker: "AMZN", yahooTicker: "AMZN", cik: "0001018724", exchange: "NASDAQ", sector: "Consumer", description: "E-commerce, cloud infrastructure and digital services.", stockSplits: [{ date: "2022-06-06", ratio: 20 }] }),
  us({ name: "Alphabet Inc.", ticker: "GOOGL", yahooTicker: "GOOGL", cik: "0001652044", exchange: "NASDAQ", sector: "Communication", description: "Class A shares in search, advertising, cloud and digital platforms.", stockSplits: [{ date: "2022-07-18", ratio: 20 }] }),
  us({ name: "Alphabet Inc.", ticker: "GOOG", yahooTicker: "GOOG", cik: "0001652044", exchange: "NASDAQ", sector: "Communication", description: "Class C shares in search, advertising, cloud and digital platforms.", stockSplits: [{ date: "2022-07-18", ratio: 20 }] }),
  us({ name: "Broadcom Inc.", ticker: "AVGO", yahooTicker: "AVGO", cik: "0001730168", exchange: "NASDAQ", sector: "Semiconductors", description: "Semiconductor and infrastructure software products.", stockSplits: [{ date: "2024-07-15", ratio: 10 }] }),
  us({ name: "Meta Platforms, Inc.", ticker: "META", yahooTicker: "META", cik: "0001326801", exchange: "NASDAQ", sector: "Communication services", description: "Social platforms, digital advertising and AI." }),
  us({ name: "Tesla, Inc.", ticker: "TSLA", yahooTicker: "TSLA", cik: "0001318605", exchange: "NASDAQ", sector: "Automotive", description: "Electric vehicles, energy storage and generation.", stockSplits: [{ date: "2020-08-31", ratio: 5 }, { date: "2022-08-25", ratio: 3 }] }),
  us({ name: "Berkshire Hathaway Inc.", ticker: "BRK.B", yahooTicker: "BRK-B", cik: "0001067983", exchange: "NYSE", sector: "Holding company", description: "Insurance-led diversified holding company.", businessType: "holding" }),
  us({ name: "Micron Technology, Inc.", ticker: "MU", yahooTicker: "MU", cik: "0000723125", exchange: "NASDAQ", sector: "Semiconductors", description: "Memory and storage semiconductor products." }),
  us({ name: "Eli Lilly and Company", ticker: "LLY", yahooTicker: "LLY", cik: "0000059478", exchange: "NYSE", sector: "Pharmaceuticals", description: "Medicines across diabetes, obesity, oncology and neuroscience." }),
  us({ name: "JPMorgan Chase & Co.", ticker: "JPM", yahooTicker: "JPM", cik: "0000019617", exchange: "NYSE", sector: "Banking", description: "Global banking and financial services.", businessType: "bank" }),
  us({ name: "Walmart Inc.", ticker: "WMT", yahooTicker: "WMT", cik: "0000104169", exchange: "NYSE", sector: "Retail", description: "Global retail and membership warehouse operations." }),
  us({ name: "Advanced Micro Devices, Inc.", ticker: "AMD", yahooTicker: "AMD", cik: "0000002488", exchange: "NASDAQ", sector: "Semiconductors", description: "High-performance computing and graphics processors." }),
  us({ name: "Visa Inc.", ticker: "V", yahooTicker: "V", cik: "0001403161", exchange: "NYSE", sector: "Payments", description: "Global electronic payments network.", stockSplits: [{ date: "2015-03-19", ratio: 4 }] }),
  us({ name: "Johnson & Johnson", ticker: "JNJ", yahooTicker: "JNJ", cik: "0000200406", exchange: "NYSE", sector: "Healthcare", description: "Medicines and medical technology." }),
  us({ name: "Exxon Mobil Corporation", ticker: "XOM", yahooTicker: "XOM", cik: "0000034088", exchange: "NYSE", sector: "Energy", description: "Integrated energy and chemical operations." }),
  us({ name: "Mastercard Incorporated", ticker: "MA", yahooTicker: "MA", cik: "0001141391", exchange: "NYSE", sector: "Payments", description: "Global payments network and data services.", stockSplits: [{ date: "2014-01-22", ratio: 10 }] }),
  us({ name: "Intel Corporation", ticker: "INTC", yahooTicker: "INTC", cik: "0000050863", exchange: "NASDAQ", sector: "Semiconductors", description: "Processors, data-center products and semiconductor manufacturing." }),
  us({ name: "Oracle Corporation", ticker: "ORCL", yahooTicker: "ORCL", cik: "0001341439", exchange: "NYSE", sector: "Software", description: "Database, enterprise applications and cloud infrastructure." }),
  us({ name: "AbbVie Inc.", ticker: "ABBV", yahooTicker: "ABBV", cik: "0001551152", exchange: "NYSE", sector: "Pharmaceuticals", description: "Biopharmaceutical medicines across immunology, oncology and neuroscience." }),
  us({ name: "Bank of America Corporation", ticker: "BAC", yahooTicker: "BAC", cik: "0000070858", exchange: "NYSE", sector: "Banking", description: "Consumer and commercial banking and markets.", businessType: "bank" }),
  us({ name: "Cisco Systems, Inc.", ticker: "CSCO", yahooTicker: "CSCO", cik: "0000858877", exchange: "NASDAQ", sector: "Networking", description: "Networking, security and collaboration technology." }),
  us({ name: "Palantir Technologies Inc.", ticker: "PLTR", yahooTicker: "PLTR", cik: "0001321655", exchange: "NASDAQ", sector: "Software", description: "Data integration and artificial-intelligence software platforms." }),
  us({ name: "Chevron Corporation", ticker: "CVX", yahooTicker: "CVX", cik: "0000093410", exchange: "NYSE", sector: "Energy", description: "Integrated energy and chemical operations." }),
  us({ name: "Costco Wholesale Corporation", ticker: "COST", yahooTicker: "COST", cik: "0000909832", exchange: "NASDAQ", sector: "Retail", description: "Membership warehouse retail." }),
];

export const COMPANIES = DEFAULT_WATCHLIST;

/**
 * The built-in list as bare tickers, minus the ones with no filing feed.
 *
 * This is only ever a fallback now. A reader's watchlist lives in their own
 * browser and may hold companies this file has never heard of, so the endpoints
 * that used to read this list directly ask the client which companies it
 * actually follows and fall back here when it does not say.
 */
export const COVERED_TICKERS = DEFAULT_WATCHLIST
  .filter((company) => company.resolutionStatus !== "unresolved")
  .map((company) => company.ticker);

export function companyByTicker(ticker: string) {
  return DEFAULT_WATCHLIST.find((company) => company.ticker.toUpperCase() === ticker.toUpperCase());
}

export function addCompanyUnique(watchlist: CompanyProfile[], company: CompanyProfile) {
  return watchlist.some((item)=>item.ticker.toUpperCase()===company.ticker.toUpperCase()) ? watchlist : [...watchlist,company];
}
