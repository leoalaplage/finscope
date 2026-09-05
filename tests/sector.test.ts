import { describe, expect, it } from "vitest";
import { companySector, sectorFromDescription, sectorFromSicCode, stated } from "../lib/sector";

/**
 * A sector for every filer, not for the twenty-seven on the built-in list.
 *
 * The SEC's ticker registry carries identity and no industry, so a company
 * reached by typing its ticker used to be "Unclassified" on its own page and
 * under the word "Watchlist" on the home page. Its classification code is in
 * the submissions document this application already reads for the economic
 * model; this is that code, said in the words the site already uses.
 */
describe("a company's sector", () => {
  it("gives two filers doing the same thing the same word", () => {
    expect(sectorFromSicCode(3674)).toBe("Semiconductors");
    expect(sectorFromSicCode(7372)).toBe("Software");
    expect(sectorFromSicCode(2834)).toBe("Pharmaceuticals");
    expect(sectorFromSicCode(6022)).toBe("Banking");
    expect(sectorFromSicCode(5331)).toBe("Retail");
    expect(sectorFromSicCode(1311)).toBe("Energy");
  });

  it("reads a narrow code inside the group that contains it", () => {
    // 36 is electrical equipment at large; 3674 is not, and 3663 is not either.
    expect(sectorFromSicCode(3661)).toBe("Networking");
    expect(sectorFromSicCode(3690)).toBe("Electronics");
    // 73 is business services at large; packaged software is its own thing.
    expect(sectorFromSicCode(7389)).toBe("Business services");
    expect(sectorFromSicCode(7370)).toBe("Technology");
    // Booking files under a code the classification calls transportation
    // services and every reader calls travel.
    expect(sectorFromSicCode(4700)).toBe("Travel");
    expect(sectorFromSicCode(4512)).toBe("Airlines");
    // The residual machinery code the semiconductor equipment makers file under.
    expect(sectorFromSicCode(3559)).toBe("Semiconductors");
    expect(sectorFromSicCode(3555)).toBe("Industrials");
  });

  it("accepts the code as the string the SEC sometimes files it as", () => {
    expect(sectorFromSicCode("3674")).toBe("Semiconductors");
    expect(sectorFromSicCode(null)).toBeNull();
    expect(sectorFromSicCode(undefined)).toBeNull();
  });

  it("falls back to the SEC's own sentence for a code it does not map", () => {
    expect(companySector({ sic: 9995, sicDescription: "Non-Operating Establishments" })).toBe("Non-Operating Establishments");
    // A mapped code wins: it is the word the rest of the site groups by.
    expect(companySector({ sic: 7372, sicDescription: "Services-Prepackaged Software" })).toBe("Software");
    expect(companySector({ sic: null, sicDescription: null })).toBeNull();
  });

  it("keeps the SEC's wording but not its block capitals", () => {
    expect(sectorFromDescription("Services-Prepackaged Software")).toBe("Services-Prepackaged Software");
    expect(sectorFromDescription("PHARMACEUTICAL PREPARATIONS")).toBe("Pharmaceutical Preparations");
    expect(sectorFromDescription("   ")).toBeNull();
  });

  it("treats the resolver's placeholders as the absences they are", () => {
    expect(stated("Unclassified")).toBeNull();
    expect(stated("US listing")).toBeNull();
    expect(stated("Nasdaq")).toBe("Nasdaq");
    expect(stated(undefined)).toBeNull();
  });
});
