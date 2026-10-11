import { describe, expect, it } from "vitest";
import { importBrokerCsv, parseDate, parseNumber } from "@/lib/broker-csv";
import { ledger, parseTrades, positionsFromTransactions, tradedContribution, writeTrades, xirr } from "@/lib/transactions";

const strip = (result: ReturnType<typeof importBrokerCsv>) => result.transactions.map(({ id, ...rest }) => { void id; return rest; });

describe("broker CSV import", () => {
  it("reads Interactive Brokers' Trades section, with sales as negative quantities", () => {
    const csv = [
      "Statement,Header,Field Name,Field Value",
      "Statement,Data,Period,\"January 1, 2025 - June 30, 2025\"",
      "Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,C. Price,Proceeds,Comm/Fee,Basis,Realized P/L,Code",
      "Trades,Data,Order,Stocks,USD,AAPL,\"2025-02-03, 10:15:02\",10,228.5,229,-2285,-1,2286,0,O",
      "Trades,Data,Order,Stocks,USD,AAPL,\"2025-05-20, 14:01:11\",-4,206.1,206,824.4,-1,-914.4,-91,C",
      "Trades,SubTotal,,Stocks,USD,AAPL,,6,,,,,,,",
    ].join("\n");
    const result = importBrokerCsv(csv);
    expect(result.format).toBe("Interactive Brokers");
    expect(strip(result)).toEqual([
      { ticker: "AAPL", date: "2025-02-03", kind: "buy", shares: 10, price: 228.5, fee: 1 },
      { ticker: "AAPL", date: "2025-05-20", kind: "sell", shares: 4, price: 206.1, fee: 1 },
    ]);
  });

  it("reads Schwab, skipping dividends and reading 'as of' dates", () => {
    const csv = [
      "\"Date\",\"Action\",\"Symbol\",\"Description\",\"Quantity\",\"Price\",\"Fees & Comm\",\"Amount\"",
      "\"10/03/2025 as of 10/01/2025\",\"Buy\",\"MSFT\",\"MICROSOFT CORP\",\"5\",\"$512.30\",\"\",\"-$2,561.50\"",
      "\"09/12/2025\",\"Qualified Dividend\",\"MSFT\",\"MICROSOFT CORP\",\"\",\"\",\"\",\"$4.15\"",
      "\"08/01/2025\",\"Sell\",\"KO\",\"COCA-COLA\",\"10\",\"$68.10\",\"$0.02\",\"$680.98\"",
    ].join("\n");
    const result = importBrokerCsv(csv);
    expect(result.format).toBe("Charles Schwab");
    expect(strip(result)).toEqual([
      { ticker: "MSFT", date: "2025-10-03", kind: "buy", shares: 5, price: 512.3 },
      { ticker: "KO", date: "2025-08-01", kind: "sell", shares: 10, price: 68.1, fee: 0.02 },
    ]);
    expect(result.skipped).toHaveLength(1);
  });

  it("reads Fidelity's sentences and Robinhood's codes", () => {
    const fidelity = importBrokerCsv([
      "Run Date,Action,Symbol,Description,Type,Quantity,Price ($),Commission ($),Fees ($),Accrued Interest ($),Amount ($),Settlement Date",
      "06/02/2025,\" YOU BOUGHT NVIDIA CORPORATION (NVDA) (Cash)\",NVDA,NVIDIA CORPORATION,Cash,12,135.4,,,,-1624.8,06/03/2025",
      "05/15/2025,\" DIVIDEND RECEIVED NVIDIA (NVDA) (Cash)\",NVDA,NVIDIA,Cash,,,,,,0.12,",
    ].join("\n"));
    expect(fidelity.format).toBe("Fidelity");
    expect(strip(fidelity)).toEqual([{ ticker: "NVDA", date: "2025-06-02", kind: "buy", shares: 12, price: 135.4 }]);
    const robinhood = importBrokerCsv([
      "\"Activity Date\",\"Process Date\",\"Settle Date\",\"Instrument\",\"Description\",\"Trans Code\",\"Quantity\",\"Price\",\"Amount\"",
      "\"3/14/2024\",\"3/14/2024\",\"3/18/2024\",\"TSLA\",\"Tesla\",\"Sell\",\"2\",\"$163.57\",\"$327.14\"",
      "\"3/1/2024\",\"3/1/2024\",\"3/5/2024\",\"TSLA\",\"Tesla\",\"Buy\",\"3\",\"$202.64\",\"($607.92)\"",
      "\"2/20/2024\",\"2/20/2024\",\"2/20/2024\",\"\",\"ACH Deposit\",\"ACH\",\"\",\"\",\"$1,000.00\"",
    ].join("\n"));
    expect(robinhood.format).toBe("Robinhood");
    expect(strip(robinhood).map((entry) => [entry.date, entry.kind, entry.shares])).toEqual([["2024-03-14", "sell", 2], ["2024-03-01", "buy", 3]]);
  });

  it("reads a positions statement without dates as holdings, with cost per share", () => {
    const result = importBrokerCsv([
      "Symbol,Description,Quantity,Last Price,Current Value,Cost Basis Total,Average Cost Basis",
      "AAPL,APPLE INC,40,$228.00,\"$9,120.00\",\"$6,000.00\",$150.00",
      "SPAXX**,HELD IN MONEY MARKET,,,$512.00,,",
      "Pending Activity,,,,$0.00,,",
    ].join("\n"));
    expect(result.kind).toBe("holdings");
    expect(result.positions).toEqual([{ ticker: "AAPL", shares: 40, cost: 150 }]);
  });

  it("leaves out ISINs and says why, and reads a semicolon file with decimal commas", () => {
    const result = importBrokerCsv([
      "Date;Type;Symbol;Quantity;Price;Fee",
      "05.03.2025;Buy;US0378331005;3;198,50;1,00",
      "06.03.2025;Buy;AAPL;2;199,10;1,00",
    ].join("\n"));
    expect(strip(result)).toEqual([{ ticker: "AAPL", date: "2025-03-06", kind: "buy", shares: 2, price: 199.1, fee: 1 }]);
    expect(result.skipped[0].reason).toMatch(/ISIN/);
  });

  it("reads numbers and dates the ways brokers write them", () => {
    expect(parseNumber("($1,234.56)")).toBe(-1234.56);
    expect(parseNumber("1.234,5", true)).toBe(1234.5);
    expect(parseDate("Oct 3, 2025")).toBe("2025-10-03");
    expect(parseDate("03/04/2025", true)).toBe("2025-04-03");
    expect(parseDate("20250131;093000")).toBe("2025-01-31");
  });
});

describe("dated trades", () => {
  const trades = parseTrades("2023-01-10 BUY AAPL 10 @ 100\n2023-06-01 buy MSFT 5 @ 300 fee 1\n2024-01-15 SELL AAPL 4 @ 150\nnot a trade");
  it("reads trades typed one a line, and writes them back", () => {
    expect(trades.map((entry) => [entry.date, entry.kind, entry.ticker, entry.shares, entry.price, entry.fee ?? 0])).toEqual([
      ["2023-01-10", "buy", "AAPL", 10, 100, 0], ["2023-06-01", "buy", "MSFT", 5, 300, 1], ["2024-01-15", "sell", "AAPL", 4, 150, 0],
    ]);
    expect(parseTrades(writeTrades(trades)).length).toBe(3);
    expect(positionsFromTransactions(trades)).toEqual([{ ticker: "AAPL", shares: 6, cost: 100 }, { ticker: "MSFT", shares: 5, cost: 301 / 1 * 1 }].map((entry) => (entry.ticker === "MSFT" ? { ...entry, cost: 1501 / 5 } : entry)));
  });

  it("states each sale's realised gain at average cost", () => {
    expect(ledger(trades).map((entry) => entry.realised)).toEqual([null, null, 200]);
  });

  it("finds the money-weighted return: 10% a year doubled in about 7.27 years", () => {
    const rate = xirr(parseTrades("2010-01-01 BUY X 1 @ 100"), 200, "2017-04-08");
    expect(rate).toBeCloseTo(0.1, 2);
  });

  it("takes what was paid in out of what a holding added", () => {
    const closes = [{ date: "2024-01-01", value: 100 }, { date: "2024-06-01", value: 110 }, { date: "2024-12-31", value: 120 }];
    const added = tradedContribution(parseTrades("2023-12-01 BUY X 10 @ 90\n2024-06-01 BUY X 10 @ 110"), "X", closes, "2024-01-01");
    // 20 shares at 120, less 10 at 100, less the 1,100 paid in June.
    expect(added).toBe(2400 - 1000 - 1100);
  });
});
