/**
 * What a company has announced, read from its SEC index: every current
 * report (8-K) by the items it files under, in plain words, with the reports,
 * proxy statements, registrations and activist stakes around them.
 *
 * An 8-K says what it is about in its item numbers before it says anything
 * else: 5.02 is a director or an officer arriving or leaving, 2.01 an
 * acquisition completed, 2.03 new debt, 4.02 financial statements that can no
 * longer be relied on. The index carries those numbers for every filing, so
 * a year of a company's events costs one request, and the words are the
 * SEC's own categories, not a reading of the press release.
 *
 * Pure: the submissions index in, events out.
 */

export type EventCategory = "results" | "leadership" | "deals" | "financing" | "governance" | "other";

export interface FilingEventItem { code: string; label: string; category: EventCategory; flag: boolean }

export interface FilingEvent {
  date: string;
  /** When EDGAR accepted it, to the second, where the index says. */
  accepted: string | null;
  form: string;
  accession: string;
  /** The filing's index page, and its primary document. */
  url: string;
  document: string | null;
  items: FilingEventItem[];
  /** The category the event is listed under: its first item's that is not an exhibit list. */
  category: EventCategory;
  /** Something a holder should read: a restatement, an auditor leaving, an impairment, a notice of delisting, an activist. */
  flag: boolean;
}

const ITEMS: Record<string, { label: string; category: EventCategory; flag?: boolean }> = {
  "1.01": { label: "Material agreement entered", category: "deals" },
  "1.02": { label: "Material agreement terminated", category: "deals" },
  "1.03": { label: "Bankruptcy or receivership", category: "financing", flag: true },
  "1.04": { label: "Mine safety violation", category: "other" },
  "1.05": { label: "Cybersecurity incident", category: "other", flag: true },
  "2.01": { label: "Acquisition or disposal completed", category: "deals" },
  "2.02": { label: "Results of operations", category: "results" },
  "2.03": { label: "New debt or financial obligation", category: "financing" },
  "2.04": { label: "Debt accelerated", category: "financing", flag: true },
  "2.05": { label: "Restructuring or exit costs", category: "other", flag: true },
  "2.06": { label: "Material impairment", category: "results", flag: true },
  "3.01": { label: "Notice of delisting or listing failure", category: "governance", flag: true },
  "3.02": { label: "Unregistered sale of shares", category: "financing" },
  "3.03": { label: "Shareholders' rights modified", category: "governance" },
  "4.01": { label: "Auditor changed", category: "governance", flag: true },
  "4.02": { label: "Past statements no longer reliable", category: "results", flag: true },
  "5.01": { label: "Change in control", category: "deals", flag: true },
  "5.02": { label: "Director or officer change", category: "leadership" },
  "5.03": { label: "Charter or bylaws amended", category: "governance" },
  "5.04": { label: "Pension plan trading suspended", category: "governance" },
  "5.05": { label: "Code of ethics changed", category: "governance" },
  "5.06": { label: "Shell company status changed", category: "governance" },
  "5.07": { label: "Shareholder vote results", category: "governance" },
  "5.08": { label: "Director nominations", category: "governance" },
  "6.01": { label: "ABS information", category: "other" },
  "7.01": { label: "Regulation FD disclosure", category: "other" },
  "8.01": { label: "Other events", category: "other" },
};

/** Forms besides the 8-K that are events in their own right; the rest (Form 4, 144, 424B prospectus notes) have panels of their own or are noise. */
const FORMS: Record<string, { label: string; category: EventCategory; flag?: boolean }> = {
  "10-K": { label: "Annual report", category: "results" },
  "10-K/A": { label: "Annual report amended", category: "results" },
  "10-Q": { label: "Quarterly report", category: "results" },
  "10-Q/A": { label: "Quarterly report amended", category: "results" },
  "20-F": { label: "Annual report", category: "results" },
  "40-F": { label: "Annual report", category: "results" },
  "DEF 14A": { label: "Proxy statement", category: "governance" },
  "DEFM14A": { label: "Merger proxy statement", category: "deals" },
  "PREM14A": { label: "Preliminary merger proxy", category: "deals" },
  "S-1": { label: "Share offering registered", category: "financing" },
  "S-3": { label: "Shelf registration", category: "financing" },
  "S-3ASR": { label: "Shelf registration", category: "financing" },
  "S-4": { label: "Merger shares registered", category: "deals" },
  "SC 13D": { label: "Activist stake disclosed (13D)", category: "deals", flag: true },
  "SC 13D/A": { label: "Activist stake amended (13D/A)", category: "deals" },
  "SCHEDULE 13D": { label: "Activist stake disclosed (13D)", category: "deals", flag: true },
  "SCHEDULE 13D/A": { label: "Activist stake amended (13D/A)", category: "deals" },
  "SC TO-T": { label: "Tender offer by a third party", category: "deals", flag: true },
  "SC TO-I": { label: "Tender offer for own shares", category: "financing" },
  "25-NSE": { label: "Security delisted from an exchange", category: "governance" },
  "NT 10-K": { label: "Annual report late", category: "results", flag: true },
  "NT 10-Q": { label: "Quarterly report late", category: "results", flag: true },
};

export interface SubmissionsRecent {
  form: string[];
  filingDate: string[];
  accessionNumber: string[];
  items?: string[];
  acceptanceDateTime?: string[];
  primaryDocument?: string[];
}

/** Every event in the index, newest first, back to `since`. */
export function filingEvents(recent: SubmissionsRecent, cik: string, since: string): FilingEvent[] {
  const events: FilingEvent[] = [];
  for (let index = 0; index < recent.form.length; index++) {
    const form = recent.form[index];
    const date = recent.filingDate[index];
    if (!date || date < since) continue;
    const accession = recent.accessionNumber[index];
    const folder = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}/`;
    const document = recent.primaryDocument?.[index] ? `${folder}${recent.primaryDocument[index]}` : null;
    let items: FilingEventItem[];
    if (form === "8-K" || form === "8-K/A") {
      items = (recent.items?.[index] ?? "").split(",").map((code) => code.trim()).filter((code) => code && code !== "9.01")
        .map((code) => {
          const known = ITEMS[code];
          return { code, label: known?.label ?? `Item ${code}`, category: known?.category ?? "other", flag: known?.flag ?? false };
        });
      if (!items.length) items = [{ code: "", label: form === "8-K/A" ? "Current report amended" : "Current report", category: "other", flag: false }];
      if (form === "8-K/A") items = items.map((item) => ({ ...item, label: `${item.label} (amended)` }));
    } else {
      const known = FORMS[form];
      if (!known) continue;
      items = [{ code: form, label: known.label, category: known.category, flag: known.flag ?? false }];
    }
    events.push({
      date, accepted: recent.acceptanceDateTime?.[index] ?? null, form, accession,
      url: `${folder}${accession}-index.htm`, document,
      items, category: items[0].category, flag: items.some((item) => item.flag),
    });
  }
  return events.sort((left, right) => (right.accepted ?? right.date).localeCompare(left.accepted ?? left.date));
}

/**
 * The item's official title, where a document prints it on the line after the
 * number ("Departure of Directors or Certain Officers; Election of Directors;
 * …"), is not news: the text starts at the first sentence after it.
 */
const TITLE_START = /^(departure of directors|results of operations|entry into a material|termination of a material|completion of acquisition|creation of a direct|triggering events|costs associated|material impairments|notice of delisting|unregistered sales|material modification|changes in registrant|non-reliance|changes in control|amendments to articles|submission of matters|regulation fd|other events|shareholder director nominations)/i;
const SENTENCE_START = /\s(?=(?:On|Effective|As previously|As disclosed|In connection|Pursuant|The Company|The Board|We |Our )\b|[A-Z][\w&.'-]+(?: [A-Z][\w&.'-]+)*,? (?:Inc|Corp|Corporation|Company|Co|Ltd|plc|N\.V)\b)/;
function withoutTitle(text: string): string {
  if (!TITLE_START.test(text)) return text;
  const head = text.slice(0, 320);
  const period = head.search(/\s\.\s|\.\s(?=[A-Z])/);
  const sentence = head.search(SENTENCE_START);
  const cut = [period >= 0 ? period + (head[period] === " " ? 3 : 2) : -1, sentence >= 0 ? sentence + 1 : -1].filter((at) => at > 15).sort((a, b) => a - b)[0];
  return cut != null ? text.slice(cut).trim() : text;
}

/**
 * The opening of each item in an 8-K: the sentences under "Item 5.02" and its
 * like, so a reader sees who left or what was bought without opening the
 * filing. From the document's paragraphs (lib/adapters/business-description.ts
 * splits them); boilerplate about forward-looking statements is skipped.
 */
export function itemExcerpts(lines: string[], codes: string[]): Array<{ code: string; text: string }> {
  const excerpts: Array<{ code: string; text: string }> = [];
  for (const code of codes) {
    const pattern = new RegExp(`^item\\s*${code.replace(".", "\\.")}\\b`, "i");
    const at = lines.findIndex((line) => pattern.test(line) && line.length < 220);
    if (at < 0) continue;
    // The heading line may carry its first sentence after the title.
    const following = lines.slice(at + 1, at + 12).filter((line) => !/^item\s*\d/i.test(line));
    let text = "";
    for (const line of following) {
      if (/^item\s*\d/i.test(line) || /^signature/i.test(line)) break;
      if (line.length < 60 || /forward-looking|^\(d\)\s*exhibits|exhibit\s+\d/i.test(line)) continue;
      text += (text ? " " : "") + line;
      if (text.length > 360) break;
    }
    text = withoutTitle(text);
    if (text) excerpts.push({ code, text: text.length > 480 ? `${text.slice(0, 477).replace(/\s+\S*$/, "")}…` : text });
  }
  return excerpts;
}
