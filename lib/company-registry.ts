import type { CompanyProfile } from "./types";

export const COMPANIES: CompanyProfile[] = [
  { name: "Apple Inc.", ticker: "AAPL", cik: "0000320193", exchange: "NASDAQ", currency: "USD", sector: "Technology", description: "Consumer technology, devices and services.", stockSplits: [{ date: "2014-06-09", ratio: 7 }, { date: "2020-08-31", ratio: 4 }] },
  { name: "Microsoft Corporation", ticker: "MSFT", cik: "0000789019", exchange: "NASDAQ", currency: "USD", sector: "Technology", description: "Cloud software, productivity and computing." },
  { name: "Amazon.com, Inc.", ticker: "AMZN", cik: "0001018724", exchange: "NASDAQ", currency: "USD", sector: "Consumer cyclical", description: "E-commerce, cloud infrastructure and media.", stockSplits: [{ date: "2022-06-06", ratio: 20 }] },
  { name: "NVIDIA Corporation", ticker: "NVDA", cik: "0001045810", exchange: "NASDAQ", currency: "USD", sector: "Semiconductors", description: "Accelerated computing platforms and software.", stockSplits: [{ date: "2021-07-20", ratio: 4 }, { date: "2024-06-10", ratio: 10 }] },
  { name: "Tesla, Inc.", ticker: "TSLA", cik: "0001318605", exchange: "NASDAQ", currency: "USD", sector: "Automotive", description: "Electric vehicles, energy generation and storage.", stockSplits: [{ date: "2020-08-31", ratio: 5 }, { date: "2022-08-25", ratio: 3 }] },
  { name: "Palantir Technologies Inc.", ticker: "PLTR", cik: "0001321655", exchange: "NASDAQ", currency: "USD", sector: "Software", description: "Data integration and artificial intelligence software." },
];

export function findCompany(query: string) {
  const needle = query.trim().toLowerCase();
  return COMPANIES.filter((company) =>
    company.ticker.toLowerCase().includes(needle) || company.name.toLowerCase().includes(needle),
  );
}
