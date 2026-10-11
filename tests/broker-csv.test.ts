import { describe, expect, it } from "vitest";
import { applyIsins, convertCurrencies, importBrokerCsv, parseDate, parseNumber } from "@/lib/broker-csv";
import { usListing } from "@/lib/adapters/isin";
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

  it("reads a semicolon file with decimal commas, day first, an ISIN standing in for its ticker", () => {
    const result = importBrokerCsv([
      "Date;Type;Symbol;Quantity;Price;Fee",
      "05.03.2025;Buy;US0378331005;3;198,50;1,00",
      "06.03.2025;Buy;AAPL;2;199,10;1,00",
    ].join("\n"));
    expect(strip(result).map((entry) => [entry.ticker, entry.date, entry.price])).toEqual([["US0378331005", "2025-03-05", 198.5], ["AAPL", "2025-03-06", 199.1]]);
    expect(result.isins).toEqual([{ isin: "US0378331005", name: null }]);
  });

  it("reads Degiro's export: ISINs, signed quantities, and the currency beside the price and the fee", () => {
    const csv = [
      "Date,Time,Product,ISIN,Reference exchange,Venue,Quantity,Price,,Local value,,Value,,Exchange rate,Transaction and/or third,,Total,,Order ID",
      "14-03-2025,15:31,APPLE INC. - COMMON ST,US0378331005,NDQ,XNAS,5,213.49,USD,-1067.45,USD,-982.47,EUR,1.0865,-1.00,EUR,-983.47,EUR,abc-1",
      "02-06-2025,10:05,ASML HOLDING,NL0010273215,EAM,XAMS,-2,612.40,EUR,1224.80,EUR,1224.80,EUR,,-2.00,EUR,1222.80,EUR,abc-2",
    ].join("\n");
    const result = importBrokerCsv(csv);
    expect(result.format).toBe("Degiro");
    expect(strip(result).map((entry) => [entry.ticker, entry.date, entry.kind, entry.shares, entry.price, entry.fee])).toEqual([
      ["US0378331005", "2025-03-14", "buy", 5, 213.49, 1], ["NL0010273215", "2025-06-02", "sell", 2, 612.4, 2],
    ]);
    // The first trade was dealt in dollars with a fee in euros; the second entirely in euros.
    expect(Object.values(result.currencies)).toEqual([{ price: "USD", fee: "EUR" }, { price: "EUR" }]);
    expect(result.isins.map((entry) => entry.name)).toEqual(["APPLE INC. - COMMON ST", "ASML HOLDING"]);
  });

  it("reads Degiro in French and Trade Republic in German", () => {
    const french = importBrokerCsv([
      "Date,Heure,Produit,Code ISIN,Place boursière,Lieu d'exécution,Quantité,Cours,,Valeur locale,,Valeur,,Taux de change,Frais de courtage,,Montant négocié,,ID Ordre",
      "03-02-2025,09:12,MICROSOFT CORP,US5949181045,NDQ,XNAS,4,410.10,USD,-1640.40,USD,-1580.00,EUR,1.0383,-2.00,EUR,-1582.00,EUR,x",
    ].join("\n"));
    expect(french.format).toBe("Degiro");
    expect(strip(french).map((entry) => [entry.ticker, entry.date, entry.shares, entry.price])).toEqual([["US5949181045", "2025-02-03", 4, 410.1]]);
    const german = importBrokerCsv([
      "Datum;Typ;Wertpapier;ISIN;Stück;Kurs;Betrag;Gebühr;Währung",
      "12.05.2025;Kauf;NVIDIA Corp.;US67066G1040;3,5;102,40;-358,40;1,00;EUR",
      "20.05.2025;Dividende;NVIDIA Corp.;US67066G1040;;;0,04;;EUR",
      "01.07.2025;Verkauf;NVIDIA Corp.;US67066G1040;1;135,10;135,10;1,00;EUR",
    ].join("\n"));
    expect(german.format).toBe("Trade Republic / ISIN export");
    expect(strip(german).map((entry) => [entry.date, entry.kind, entry.shares, entry.price])).toEqual([["2025-05-12", "buy", 3.5, 102.4], ["2025-07-01", "sell", 1, 135.1]]);
    expect(german.skipped).toHaveLength(1);
    expect(Object.values(german.currencies)).toEqual([{ price: "EUR" }, { price: "EUR" }]);
  });

  it("maps ISINs to US tickers and lists the ones without a US listing", () => {
    const result = importBrokerCsv([
      "Date,Product,ISIN,Quantity,Price",
      "2025-01-02,APPLE,US0378331005,2,240",
      "2025-01-03,ASML,NL0010273215,1,700",
    ].join("\n"));
    const mapped = applyIsins(result, { US0378331005: { ticker: "AAPL" }, NL0010273215: null });
    expect(strip(mapped).map((entry) => entry.ticker)).toEqual(["AAPL"]);
    expect(mapped.skipped[0].reason).toMatch(/ASML \(NL0010273215\): no listing on a US exchange/);
  });

  it("prices a trade in euros in dollars at its own day's rate", () => {
    const result = importBrokerCsv("Datum;Typ;ISIN;Stück;Kurs;Gebühr;Währung\n12.05.2025;Kauf;US67066G1040;2;100,00;1,00;EUR");
    const converted = convertCurrencies(applyIsins(result, { US67066G1040: { ticker: "NVDA" } }), {
      EUR: [{ date: "2025-05-09", rate: 1.12 }, { date: "2025-05-12", rate: 1.11 }, { date: "2025-05-13", rate: 1.12 }],
    });
    expect(strip(converted)).toEqual([{ ticker: "NVDA", date: "2025-05-12", kind: "buy", shares: 2, price: 111.00000000000001, fee: 1.11 }]);
  });

  it("counts only US exchanges proper, never the OTC market", () => {
    expect(usListing([{ ticker: "AAPL", exchCode: "UW" }, { ticker: "AAPL", exchCode: "US" }, { ticker: "APC", exchCode: "GR" }])).toEqual({ ticker: "AAPL", name: "AAPL" });
    expect(usListing([{ ticker: "ASMLF", exchCode: "US" }, { ticker: "ASMLF", exchCode: "UV" }])).toBeNull();
    expect(usListing([{ ticker: "BRK/B", exchCode: "UN", name: "BERKSHIRE" }])).toEqual({ ticker: "BRK.B", name: "BERKSHIRE" });
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
