import { describe, expect, it } from "vitest";
import { chooseSymbol } from "../components/io/choose-symbol";

/** What the SEC registry answers for "apple", in its own order. */
const APPLE = [
  { ticker: "AAPL" },
  { ticker: "APLE" },
  { ticker: "MAPP" },
];

describe("what the search opens", () => {
  it("opens the company a typed name resolves to, not the name itself", () => {
    /*
     * The bug this exists for. "APPLE" is shaped exactly like a ticker — five
     * letters — so a symbol-shaped test placed before the results beat AAPL,
     * and the site answered "No SEC filer trades under APPLE" to anyone who
     * typed the name of the largest company in the world. TESLA, NVIDIA and
     * COSTCO failed the same way; names containing a space did not, which is
     * what made it hard to see.
     */
    expect(chooseSymbol("apple", APPLE)).toBe("AAPL");
    expect(chooseSymbol("Berkshire Hathaway", [{ ticker: "BRK-B" }])).toBe("BRK-B");
  });

  it("prefers the exact symbol a reader typed over the registry's first answer", () => {
    // Someone who typed APLE meant APLE, even though AAPL leads the results.
    expect(chooseSymbol("aple", APPLE)).toBe("APLE");
    expect(chooseSymbol("AAPL", APPLE)).toBe("AAPL");
  });

  it("still opens a plausible symbol before any lookup has landed", () => {
    // The results are empty for the 140 ms the debounce holds, and for however
    // long the SEC takes. Return must work in that window.
    expect(chooseSymbol("MSFT", [])).toBe("MSFT");
    expect(chooseSymbol("brk.b", [])).toBe("BRK.B");
  });

  it("opens nothing rather than something wrong", () => {
    expect(chooseSymbol("", APPLE)).toBeNull();
    expect(chooseSymbol("   ", [])).toBeNull();
    // Not shaped like a symbol and matched by nothing: there is no destination.
    expect(chooseSymbol("a company that does not exist", [])).toBeNull();
    expect(chooseSymbol("<script>", [])).toBeNull();
  });
});
