/**
 * What a company does, for every filer rather than for a list of them.
 *
 * The sector of the twenty-seven companies in the registry is written by hand.
 * Every other company — which is every company a reader reaches by typing a
 * ticker, twelve thousand of them — had the word "Unclassified", because the
 * SEC's ticker registry carries four fields and an industry is not one of them.
 *
 * It is one of them in the submissions document, which this application already
 * fetches for the SIC code that decides the economic model. So the sector is
 * read from the same fact, in two steps and in this order:
 *
 *  1. the code, mapped into the vocabulary this site already uses, so that two
 *     companies doing the same thing are given the same word and the screener
 *     can group them. "Semiconductors" is what NVIDIA carries in the registry
 *     and it is what a filer under SIC 3674 gets here;
 *  2. failing that, the SEC's own sentence for the code, which is more specific
 *     than any vocabulary and belongs to nobody else's — a company under a code
 *     this table has never heard of still says something true about itself.
 *
 * Nothing is guessed from a company's name, and a filer with neither a mapped
 * code nor a description keeps no sector at all. An absent sector is written as
 * an absence everywhere it is shown.
 */

/**
 * SIC ranges, in the words this site names a sector in.
 *
 * Ordered from the specific to the general and read first-match-wins, because
 * that is how the classification itself is shaped: 3674 is semiconductors
 * inside a group 36 that is electrical equipment at large, and 7372 is packaged
 * software inside a group 73 that is business services at large. A range that
 * needs to say something narrower is placed above the group that contains it.
 *
 * The vocabulary is the registry's wherever the registry has a word for it —
 * Semiconductors, Technology, Software, Pharmaceuticals, Banking, Retail,
 * Energy — so a company reached by search and a company on the built-in list
 * are described in the same terms rather than in two dialects.
 */
const SIC_SECTORS: ReadonlyArray<{ from: number; to: number; sector: string }> = [
  // --- Narrower than the group that contains them ------------------------
  { from: 2833, to: 2834, sector: "Pharmaceuticals" },
  { from: 2835, to: 2836, sector: "Biotechnology" },
  { from: 2840, to: 2844, sector: "Consumer goods" },
  // 3559 is "special industry machinery, not elsewhere classified", and in the
  // American register it is where the semiconductor equipment makers file:
  // Applied Materials, Lam Research, KLA. It sits with them rather than with a
  // literal reading of a residual code.
  { from: 3559, to: 3559, sector: "Semiconductors" },
  { from: 3571, to: 3579, sector: "Technology" },
  { from: 3661, to: 3669, sector: "Networking" },
  { from: 3674, to: 3674, sector: "Semiconductors" },
  { from: 3670, to: 3679, sector: "Electronics" },
  { from: 3711, to: 3716, sector: "Automotive" },
  { from: 3720, to: 3729, sector: "Aerospace & defence" },
  { from: 3760, to: 3769, sector: "Aerospace & defence" },
  { from: 3841, to: 3851, sector: "Medical devices" },
  { from: 4500, to: 4599, sector: "Airlines" },
  // Booking, Expedia and every online travel agency file under 47, which the
  // classification calls transportation services and nobody else does.
  { from: 4700, to: 4799, sector: "Travel" },
  { from: 4830, to: 4841, sector: "Media" },
  { from: 5812, to: 5813, sector: "Restaurants" },
  { from: 6021, to: 6036, sector: "Banking" },
  { from: 6199, to: 6199, sector: "Payments" },
  { from: 6798, to: 6798, sector: "Real estate" },
  { from: 7311, to: 7319, sector: "Advertising" },
  { from: 7372, to: 7372, sector: "Software" },
  { from: 7370, to: 7379, sector: "Technology" },
  { from: 8731, to: 8731, sector: "Biotechnology" },

  // --- The major groups --------------------------------------------------
  { from: 100, to: 999, sector: "Agriculture" },
  { from: 1000, to: 1299, sector: "Mining" },
  { from: 1300, to: 1399, sector: "Energy" },
  { from: 1400, to: 1499, sector: "Mining" },
  { from: 1500, to: 1799, sector: "Construction" },
  { from: 2000, to: 2099, sector: "Food & beverage" },
  { from: 2100, to: 2199, sector: "Tobacco" },
  { from: 2200, to: 2299, sector: "Textiles" },
  { from: 2300, to: 2399, sector: "Apparel" },
  { from: 2400, to: 2499, sector: "Materials" },
  { from: 2500, to: 2599, sector: "Consumer goods" },
  { from: 2600, to: 2699, sector: "Materials" },
  { from: 2700, to: 2799, sector: "Media" },
  { from: 2800, to: 2899, sector: "Chemicals" },
  { from: 2900, to: 2999, sector: "Energy" },
  { from: 3000, to: 3399, sector: "Materials" },
  { from: 3400, to: 3599, sector: "Industrials" },
  { from: 3600, to: 3699, sector: "Electronics" },
  { from: 3700, to: 3799, sector: "Industrials" },
  { from: 3800, to: 3899, sector: "Instruments" },
  { from: 3900, to: 3999, sector: "Consumer goods" },
  { from: 4000, to: 4499, sector: "Transportation" },
  { from: 4600, to: 4699, sector: "Energy" },
  { from: 4800, to: 4899, sector: "Telecom" },
  { from: 4900, to: 4999, sector: "Utilities" },
  { from: 5000, to: 5199, sector: "Distribution" },
  { from: 5200, to: 5999, sector: "Retail" },
  { from: 6000, to: 6099, sector: "Banking" },
  { from: 6100, to: 6199, sector: "Consumer finance" },
  { from: 6200, to: 6299, sector: "Capital markets" },
  { from: 6300, to: 6499, sector: "Insurance" },
  { from: 6500, to: 6599, sector: "Real estate" },
  { from: 6700, to: 6799, sector: "Holding company" },
  { from: 7000, to: 7099, sector: "Hospitality" },
  { from: 7200, to: 7299, sector: "Consumer services" },
  { from: 7300, to: 7399, sector: "Business services" },
  { from: 7500, to: 7699, sector: "Consumer services" },
  { from: 7800, to: 7899, sector: "Media" },
  { from: 7900, to: 7999, sector: "Entertainment" },
  { from: 8000, to: 8099, sector: "Healthcare" },
  { from: 8200, to: 8299, sector: "Education" },
  { from: 8300, to: 8399, sector: "Consumer services" },
  { from: 8600, to: 8799, sector: "Professional services" },
];

/** The site's word for a filer's own classification code, where it has one. */
export function sectorFromSicCode(sic: number | string | null | undefined): string | null {
  const code = typeof sic === "string" ? Number.parseInt(sic, 10) : sic;
  if (code == null || !Number.isInteger(code)) return null;
  return SIC_SECTORS.find((entry) => code >= entry.from && code <= entry.to)?.sector ?? null;
}

/**
 * The SEC's own sentence for a code, tidied and not rewritten.
 *
 * Left as they write it — "Services-Prepackaged Software" is their phrasing,
 * not ours — beyond collapsing whitespace and softening a block-capital entry.
 * A sector is a fact about the filing rather than a phrase to improve, and this
 * is only ever reached for a code the table above does not cover.
 */
export function sectorFromDescription(description: string | null | undefined): string | null {
  const written = (description ?? "").replace(/\s+/g, " ").trim();
  if (!written) return null;
  if (written !== written.toUpperCase()) return written;
  return written.toLowerCase().replace(/(^|[\s\-&/])([a-z])/g, (_, before: string, letter: string) => `${before}${letter.toUpperCase()}`);
}

/** The two, in order: the mapped code, then the filer's own description. */
export function companySector(classification: { sic?: number | string | null; sicDescription?: string | null }): string | null {
  return sectorFromSicCode(classification.sic) ?? sectorFromDescription(classification.sicDescription);
}

/**
 * What a profile says when it has nothing to say.
 *
 * The resolver writes these where a filer is known only by its CIK, and no
 * screen may show either of them as though it were a fact about the business.
 */
export const PLACEHOLDER_PROFILE = new Set(["US listing", "Unclassified"]);

/** The stated part of a profile field, or nothing where it is a placeholder. */
export function stated(value: string | null | undefined): string | null {
  const written = (value ?? "").trim();
  return written && !PLACEHOLDER_PROFILE.has(written) ? written : null;
}
