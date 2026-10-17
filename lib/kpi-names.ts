import { OPERATING, type KpiUnit } from "./adapters/kpi-tables";

/**
 * What a KPI card says it measures, the same way for every company.
 *
 * A figure is read with up to four pieces of text around it: the heading
 * printed above its table (the caption), the heading over its rows (the
 * section), its own label, and the heading of its column. As printed, these
 * are table furniture — "Percentage of net sales", "(Dollar amounts in
 * millions)", "Percentage change from comparable period", "With Fuel" — and
 * strung together they rarely say what the figure is. Here each piece is
 * cleaned and sorted into what the figure measures, whose it is (a segment, a
 * country, a brand), how it is qualified (ex. fuel, constant currency) and on
 * what basis it is stated (a change on the year, the end of the quarter); the
 * card's title is put together from those, in that order:
 *
 *   Walmart U.S. comparable sales, ex. fuel · y/y
 *   Total retail square feet · end of quarter
 *
 * The unit follows from what is measured, not from the table's heading: square
 * feet and barrels are not dollars because the table prints its amounts "in
 * millions"; a yield is a percentage even where it is printed without "%".
 * A figure none of whose text names a measure, or that is a line of a
 * roll-forward, a hedge or a reconciliation, is not shown at all.
 */

export interface KpiParts {
  caption?: string | null;
  section: string | null;
  label: string;
  /** The column's heading, the heading spanning it, or a sentence's measure ("Growth on the year"). */
  measure: string | null;
  unit: KpiUnit;
  scale: string | null;
  /** The table's scale is said of its dollars: a count printed in it is not in millions. */
  dollarScale?: boolean;
  /** The figures, to tell a rate printed without "%" from a count. */
  values?: number[];
}

export interface KpiDescription {
  name: string;
  unit: KpiUnit;
  scale: string | null;
  /** Printed after the figure: what a count counts ("stores", "sq ft"), or the unit of a price ("¢", "/Mcf"). */
  suffix: string | null;
}

type Basis = "y/y" | "q/q" | "end of quarter";

/** Not an operating figure, whatever table it sits in: roll-forwards, hedges, maturities, reconciliations. */
const NOT_A_KPI = /\bthereafter\b|^note \d+\b|\b(?:beginning|opening|ending) balance\b|\bbeginning of (?:the )?(?:year|period)\b|^outstanding\b|related part(?:y|ies)|\(deduct\)|\bdeduct\b|^balance (?:at|as of)\b|^(?:beginning|opening)\b|^change in fund value|\bmaturit(?:y|ies)\b|next \d+ months|derivative|\bhedg|forward contracts?|notional|allowance for|purchase accounting|warranty|claims (?:settled|paid)|fair value|\bpurchases?\b(?! volume)|purchase price|distributions on|\badjustments?\b|\bnoi\b|\bffo\b|funds from operations|general and administrative|net real estate|leasing commissions|portfolio investment|premise equipment|performance allocations|partnership units|guaranteed minimum|well[- ]?capitali[sz]ed|loans modified|^reductions?\b|^(?:less|add|plus)\b|add \(subtract\)|total capital|repurchase|dividend|reconciliation|impairment|restructuring|goodwill|capital expenditure|\bcapex\b|depreciation|amortization|construction in progress|\boperating income\b|two-year stack|\bnet income\b|\bnotes to\b.*\bstatements\b|\bto adjusted\b|^future projects|\bdev\/ ?redev\b|full[- ]year|for the full year|year[- ]to[- ]date|\bytd\b|guidance|outlook/i;

/** Headings that say a table holds figures, not which. */
const CONTAINER = /^(?:other|others|all other|supplemental\b.*|additional (?:information|metrics|data)|key (?:operating )?(?:metrics|statistics|data|performance indicators)|kpis?|metrics|operating (?:data|metrics|statistics|results|highlights|information)|operational (?:metrics|data)|statistics|statistical (?:data|information)|business (?:metrics|highlights|data)|selected (?:operating |performance |financial )?(?:metrics|data|statistics|information)(?: and ratios)?|selected (?:financial|operating)\b.*|financial (?:highlights|data)|(?:consolidated )?results(?: of operations)?|summary(?: of .*)?|highlights|(?:first|second|third|fourth) quarter highlights|unit sales information|(?:regional|geographic|segment) (?:breakdown|information|data|results)|breakdown|unit of measure|ratios|operating ratios|underwriting ratios|amount|amounts|value|values|as reported|reported|gaap|non-gaap|operating|operations|operating statistics and related information|segment (?:results|information|data)|segments?|by segment|change from|percentage of (?:net )?(?:sales|revenues?)|as a percentage of .*|% of (?:net )?(?:sales|revenues?)|in (?:millions|thousands|billions)|unaudited)$/i;

/** The whole company, as opposed to a segment of it. */
const WHOLE = /^(?:consolidated|total company|company[- ]wide|companywide|total|enterprise|worldwide|ww|all segments)$/i;

/** A place, a channel or a part of a business: what a figure is of, not what it measures. */
const GEOGRAPHY = /\b(?:u\.s\.|us|usa|united states|north america|south america|latin america|latam|canada|mexico|brazil|europe|emea|asia|apac|asia[- ]pacific|pacific|china|japan|india|international|domestic|global|americas|middle east|africa|uk|united kingdom|germany|france|australia|northeast|northwest|southeast|southwest|south central|midwest|west|east|north|south|central|region|regional|segment|division|channel|brand|wholesale|retail|residential|commercial|industrial|consumer|enterprise|corporate)\b/i;

/** Measures that cannot be a place or a business's name. */
const STRONG_MEASURE = /comparable|\bcomps?\b|same[- ]store|like[- ]for[- ]like|\bsales\b|revenue|transactions?|traffic|ticket|customers?|subscribers?|members(?:hip)?\b|users?\b|accounts?\b|stores\b|restaurants\b|warehouses\b|locations\b|\bunits\b|unit counts?|\bcount\b|deliveries|orders\b|bookings?\b|backlog|premiums?|\bratios?\b|\brate\b|yield|margin|occupanc|revpar|\badr\b|average daily rate|\barp[ua]\b|volumes?\b|production|shipments|\baum\b|assets under|client assets|\bflows\b|square f(?:ee|oo)t|footage|\bsq\.? ?ft\b|\brsf\b|employees|headcount|capacity|load factor|seat miles|\b(?:asms?|rpms?|trasm|prasm|casm|rasm)\b|passengers?|nights\b|\bprice\b|prices\b|cost per|spend(?:ing)?\b|penetration|churn|retention|closings?|closed\b|\blots\b|\bgmv\b|gross merchandise|billed business|loans\b|deposits\b|policies|in force|claims\b|prescriptions|scripts|admissions|visits|procedures|requisitions?|gallons|barrels|\bboe\b|\bmcf\b|\bkwh\b|\bgwh\b|\bmwh\b|carloads|\btrips\b|rides\b|impressions|daily active|monthly active|\bdau\b|\bmau\b|\bdap\b|growth|organic|net (?:additions|adds)|openings|closures|apartment|cardholders|buyers|sellers|visitors|headcount|dwell|throughput|utili[sz]ation|generation\b|purchased power|\bdarts\b|\bbalances?\b|factor\b|lines\b(?=.*\b(?:mobile|wireless|access|total)\b)|\bmix\b|performance\b/i;

/** Measured in money, whatever the table's own unit. */
const MONEY = /\$|\bdollars?\b|\bauc\b|\barr\b|annual(?:ized)? recurring|recurring revenue|\bsales\b|revenue|\bprices?\b|spend(?:ing)?\b|premiums?|bookings?\b|billed business|gross merchandise|\bgmv\b|payments? volume|purchase volume|network volumes?|transaction volume|\btpv\b|\bgtv\b|\baum\b|assets\b|loans\b|deposits\b|balances?\b|\bvalue\b|\bincome\b|\bcosts?\b|\bfees?\b|\barp[ua]\b|revpar|\badr\b|average daily rate|\bper\b|backlog|\bflows\b|ticket|commitments|receivables/i;

/** Counted, never an amount of money. */
const COUNTED = /customers?\b|consumers\b|memberships\b|net (?:membership )?(?:additions|adds)\b|subscribers?|members\b|membership\b|buyers|sellers|users\b|employees|headcount|stores\b|restaurants\b|\bunits?\b|unit counts?|homes\b|\blots\b|deliveries|\bdarts\b|trades\b|orders\b|trips\b|nights\b|passengers|accounts\b|policies|lines\b|connections|production|volumes?\b|barrels|gallons|\bboe\b|\bmcf\b|\bkwh\b|\bgwh\b|\bmwh\b|carloads|\bcars\b|shipments|visitors|transactions\b|contracts\b|cases\b|claims\b|prescriptions|scripts|admissions|visits|procedures|properties|rooms\b|beds\b|wells\b|rigs\b|locations\b|branch(?:es)?\b|cardholders|\bcards\b|inputs\b|\bdays\b|impressions/i;

/** A rate, however it is printed. */
const RATE = /\byield\b|\brate\b|ratio\b|margin\b|factor\b|occupanc|utili[sz]ation|penetration|load factor|retention|churn|\bmix\b|% of\b|percentage of|share of|\bshare\b|performance\b/i;

/** A rate or a share is a level; anything else stated in per cent is its change. */
const LEVEL = /\byield\b|\brate\b|ratio\b|margin\b|factor\b|occupanc|utili[sz]ation|penetration|load factor|retention|churn|\bmix\b|% of\b|percentage of|share\b|performance\b|\bscore\b|on[- ]time|completion/i;

const COMPARABLE = /comparable|\bcomps?\b|same[- ]store|like[- ]for[- ]like|\bsss\b/i;

/** Physical units printed in a label, as a card prints them after the figure. */
const PHYSICAL: Array<[RegExp, string]> = [
  [/\bmboe\/?d\b|\bmboed\b|\bmboe per day\b/i, "MBOE/d"],
  [/\bmmboe\b/i, "MMBOE"],
  [/\bmmbbls?\b/i, "MMbbl"],
  [/\bboe\/?d\b|\bboe per day\b|\bboepd\b/i, "BOE/d"],
  [/\bmbbls?\/?d\b|\bmbbld\b|\bthousand barrels per day\b/i, "Mbbl/d"],
  [/\bmbpd\b/i, "Mbbl/d"],
  [/\b(?:bbls?|b)\/d\b|\bbarrels per day\b|\bbpd\b/i, "bbl/d"],
  [/\bbbtu\)?\/d\b/i, "BBtu/d"],
  [/\bmbd\b|\bmb\/d\b/i, "Mbbl/d"],
  [/\bmmcf\/?d\b|\bmmcfd\b|\bmmcf per day\b/i, "MMcf/d"],
  [/\bmcf\/d\b|\bmcfd\b|\bmcf per day\b/i, "Mcf/d"],
  [/\bbcf\b/i, "Bcf"],
  [/\bmmcf\b/i, "MMcf"],
  [/\bmmbtus?\b/i, "MMBtu"],
  [/\bgwhs?\b/i, "GWh"], [/\bmwhs?\b/i, "MWh"], [/\bkwhs?\b/i, "kWh"],
  [/\bmw\b/i, "MW"],
  [/\bmetric tons?\b|\btonnes\b/i, "t"],
  [/\(hours\)/i, "hours"], [/\((?:in )?miles\)/i, "miles"], [/\((?:in )?lbs\.?\)|\((?:in )?pounds\)/i, "lbs"], [/\((?:in )?tons\)/i, "tons"], [/\((?:in )?ounces\)|\boz\b/i, "oz"],
];

/** What a count counts, for the figure: "11,000 units", "1.1B sq ft". */
const NOUNS: Array<[RegExp, string]> = [
  [/square f(?:ee|oo)t|footage|\bsq\.? ?ft\b|\brsf\b/i, "sq ft"],
  [/\bunit counts?\b|\bunits\b/i, "units"],
  [/\bstores\b/i, "stores"], [/\brestaurants\b/i, "restaurants"], [/\bwarehouses\b/i, "warehouses"], [/\bclubs\b/i, "clubs"],
  [/\bsubscribers\b/i, "subscribers"], [/\bmemberships\b/i, "memberships"], [/\bcardholders\b/i, "cardholders"], [/\bmembers\b/i, "members"], [/\bcustomers\b/i, "customers"],
  [/\bemployees\b|\bheadcount\b/i, "employees"], [/\bhomes\b/i, "homes"], [/\bvehicles?\b/i, "vehicles"], [/\bdeliveries\b/i, "deliveries"],
  [/\bpolicies\b/i, "policies"], [/\baccounts\b/i, "accounts"], [/\bbranch(?:es)?\b/i, "branches"], [/\bproperties\b/i, "properties"],
  [/\brooms\b/i, "rooms"], [/\blines\b/i, "lines"], [/\borders\b/i, "orders"], [/\bpassengers\b/i, "passengers"],
];

const clean = (text: string) => text.replace(/\s+/g, " ").replace(/^[\s:;,.–—·-]+|[\s:;,–—·-]+$/g, "").trim();
const words = (text: string) => new Set(text.toLowerCase().replace(/[^a-z0-9&$%/ ]+/g, " ").split(/\s+/).filter((word) => word && !/^(?:the|of|and|in|for|by|a|an|total|net|s)$/.test(word)).map((word) => word.replace(/(?:es|s)$/, "")));
const subset = (small: Set<string>, large: Set<string>) => small.size > 0 && [...small].every((word) => large.has(word));

/** Names kept in capitals whatever the heading's case. */
const PROPER = /^(?:u\.s\.?|us|uk|mexico|canada|brazil|china|japan|india|europe|asia|africa|america|americas|latin|pacific|atlantic|germany|france|australia|korea|taiwan|macau|singapore|las|vegas|boston|international|ww)$/i;

/** "HOMES CLOSED", "Total Video Customers": a heading's case, as a sentence's. */
function sentenceCase(text: string): string {
  const tokens = text.split(" ");
  const shouting = /[A-Z]{4}/.test(text) && !/[a-z]/.test(text);
  const titled = tokens.length > 1 && tokens.filter((token) => /^[a-z]{4,}$/i.test(token)).every((token) => /^[A-Z][a-z]+$/.test(token));
  if (!shouting && !titled) return text;
  return tokens.map((token, index) => {
    if (index === 0) return shouting ? token[0] + token.slice(1).toLowerCase() : token;
    if (PROPER.test(token)) return shouting && token.length > 3 ? token[0] + token.slice(1).toLowerCase() : token;
    if (shouting) return token.length <= 3 && /^[A-Z&.]+$/.test(token) && !/^(?:BY|OF|AND|THE|TO|IN|AT|FOR|ON|OR|PER)$/.test(token) ? token : token.toLowerCase();
    // "Oil-Equivalent" as "oil-equivalent".
    return /^[A-Z][a-z]+(?:-[A-Z][a-z]+)*$/.test(token) ? token.toLowerCase() : token;
  }).join(" ");
}

interface Notes {
  scale: string | null;
  /** The scale the label or the column says itself, not the table's. */
  ownScale: string | null;
  cents: boolean; percent: boolean;
  /** "$" said by the label or its column; a table's "($ in millions)" is said of its amounts, not of every row. */
  dollars: boolean;
  tableDollars: boolean;
  suffix: string | null; qualifiers: string[]; basis: Basis | null; scopes: string[]; drop: boolean;
}

/**
 * One piece of text cleaned of what is not its subject: footnote marks, unit and period notes, the basis and the
 * qualifiers — each recorded in the notes.
 */
function strip(text: string, notes: Notes, percent: boolean): string {
  let part = ` ${text} `;
  // Footnote marks: "(1)", "(a)", "(2, 3)", "*", "®", a digit glued to a word ("Organic1").
  part = part.replace(/\s*\((?:\d{1,2}|[a-z]|[ivx]{1,4})(?:\s*,\s*(?:\d{1,2}|[a-z]))*\)/gi, " ").replace(/[*†‡§®™]+/g, " ").replace(/([a-z]{3,})\d\b/g, "$1").replace(/(?<=[a-z']{3,})\s\d(?=\s)/gi, " ");
  // The scale and the unit, wherever they are said.
  const scale = /\(\s*(?:(?:u\.s\.\s*)?(?:dollars?|\$)\s*)?(?:in\s+)?(?:\$\s*)?(thousands|millions|billions|trillions|000s?)\b[^)]*\)/i.exec(part);
  if (scale && !/unless|except|otherwise/i.test(scale[0])) {
    notes.scale = /^000/.test(scale[1]) ? "thousands" : scale[1].toLowerCase();
    if (/dollars|\$/i.test(scale[0])) notes.dollars = true;
  }
  if (/\bcents\b|¢/i.test(part)) notes.cents = true;
  if (/\(\s*%\s*\)|\(percent\)/i.test(part)) notes.percent = true;
  if (/\((?:in )?(?:u\.s\. )?dollars\)|\(\$\)/i.test(part)) notes.dollars = true;
  const per = /\(\s*\$\s*(?:per|\/)\s*([a-z]+)\s*\)|\$\/([a-z]+)\b/i.exec(part);
  if (per) { notes.dollars = true; notes.suffix = `/${per[1] ?? per[2]}`; }
  // A column headed by its unit alone ("$/Mcf") holds prices.
  if (per && /^\s*\(?\s*\$\s*(?:per|\/)\s*[a-z]+\s*\)?\s*$/i.test(part)) return "Average price";
  for (const [pattern, unit] of PHYSICAL) if (pattern.test(part)) { notes.suffix ??= unit; break; }
  // Any parenthesis that is a note: units, scales, periods, "non-GAAP".
  part = part.replace(/\s*\([^)]*(?:millions|thousands|billions|trillions|000s?|dollars|\$|cents|%|percent|per\b|\/|hours|non-gaap|preliminary|unaudited|in )[^)]*\)/gi, " ");
  part = part.replace(/\s*[–—-]\s*(?:mmcf|mcf|bcf|mwh|gwh|kwh|boe|mboe)\b/gi, " ").replace(/\$/g, " ");
  // The basis: the end of the period, a change on the year or on the quarter.
  const end = /,?\s*\(?\b(?:at|as of)\s+(?:the\s+)?(?:period|quarter)[- ]end\b\)?|,?\s*\(?\b(?:at\s+)?(?:the\s+)?end of (?:the\s+)?(?:period|quarter)\b\)?|,?\s*\bas of [A-Z][a-z]+\.? \d{1,2}\b,?(?:\s+\d{4})?|^\s*ending\s+|,?\s*\bat period end\b/i;
  if (end.test(part)) { notes.basis ??= "end of quarter"; part = part.replace(end, " "); }
  part = part.replace(/\s*\bduring the (?:period|quarter)\b/i, " ")
    .replace(/\s*\bfor (?:the )?(?:first|second|third|fourth) quarter(?: (?:of )?(?:fiscal )?(?:19|20)\d\d)?\b/i, " ")
    .replace(/\s+by (?:type|segment|region|market|geography|brand|channel|country)\b/i, " ")
    // An acronym the company gives its measure: "Monthly active platform consumers ("MAPCs")".
    .replace(/\s*\(\s*["“]?[A-Z]{2,}s?["”]?\s*\)/g, " ");
  // A date names the period, not the figure: "July 29, 2026 LTL tons", "Licensed beds (at June 30)", "Fiscal 2026, U.S. domestic".
  const dated = /\(?\b(?:at |as of )?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}(?:,? (?:19|20)\d\d)?\b\)?,?/i;
  if (dated.test(part)) { notes.basis ??= "end of quarter"; part = part.replace(dated, " "); }
  part = part.replace(/\bfiscal (?:year )?(?:19|20)\d\d\b,?|\b(?:19|20)\d\d\b,?(?=\s+[A-Za-z])/gi, " ").replace(/^\s*key\s+/i, " ").replace(/\s+at$/i, " ");
  if (/^\s*sequentially,?\s/i.test(part)) { notes.basis = "q/q"; part = part.replace(/^\s*sequentially,?\s*/i, " "); }
  if (/\(annualized\)/i.test(part)) { notes.qualifiers.push("annualized"); part = part.replace(/\s*\(annualized\)/gi, " "); }
  part = part.replace(/\s*\(continued\)|,\s*continued\b/gi, " ").replace(/\bCO 2\b/g, "CO2").replace(/\s+%\s*$/, " ");
  // A unit printed beside the label is said once, after the figure: "Net oil-equivalent production (MBOED)".
  part = part.replace(/\s*\(([^)]*)\)/g, (match, inner: string) => (PHYSICAL.some(([pattern]) => pattern.test(inner)) ? " " : match));
  // Qualifiers: constant currency, trailing twelve months, with or without fuel.
  const currency = /,?\s*\b(?:on a constant[- ]currency basis|at constant currency|in constant currency|constant[- ]currency|constant \$|fixed[- ]currency|currency[- ]neutral|f\/?x[- ]neutral|excluding f\/x|ex-?fx|(?:growth )?at constant currency)\b,?/gi;
  if (currency.test(part)) { notes.qualifiers.push("constant currency"); part = part.replace(currency, " "); }
  if (/\bttm\b|trailing[- ]twelve[- ]months?|trailing 12 months|trailing four quarters/i.test(part)) { notes.qualifiers.push("trailing 12 months"); part = part.replace(/,?\s*(?:on a\s+)?\b(?:ttm|trailing[- ]twelve[- ]months?|trailing 12 months|trailing four quarters)\b(?:\s+basis)?,?/gi, " "); }
  part = part.replace(/\(\s*(?:ex\.?|excl\.?|excluding|without)\s+([^)]+)\)/gi, (_, what: string) => { notes.qualifiers.push(`ex. ${what.trim().toLowerCase()}`); return " "; });
  // A heading printed in parentheses: "(Square Footage)".
  const whole = clean(clean(part).replace(/^\(([^()]+)\)$/, "$1"));
  const without = /^(?:excluding|without|ex\.?)\s+(.+)$/i.exec(whole);
  if (without) { notes.qualifiers.push(`ex. ${without[1].toLowerCase()}`); return ""; }
  const withIt = /^(?:including|with)\s+(.+)$/i.exec(whole);
  if (withIt) { notes.qualifiers.push(`incl. ${withIt[1].toLowerCase()}`); return ""; }
  // A change, said at the end of the label or as the whole heading: on the year, for a figure stated in per cent.
  const change = /,?\s*(?:\b(?:y\/y|yoy|year[- ]over[- ]year)\s+)?(?:(?:% |percent |percentage )?(?:change|growth)(?: rate)?(?: from comparable period| on the year| over (?:the )?prior year| vs\.? prior year)?|percentage change from comparable period|growth on the year|increase\s*\/?\s*\(?decrease\)?|increase|decrease|% change|\by\/y\b)\s*$/i;
  // "Organic growth" keeps its noun: organic is not a measure on its own.
  if (percent && change.test(whole)) { notes.basis ??= "y/y"; part = whole.replace(change, ""); if (/\borganic$/i.test(part.trim())) part = `${part.trim()} growth`; }
  else if (percent && /^(?:change|growth) in\s+/i.test(whole)) { notes.basis ??= "y/y"; part = whole.replace(/^(?:change|growth) in\s+/i, ""); }
  else if (percent && /^growth rate\b/i.test(whole)) { notes.basis ??= "y/y"; part = whole.replace(/^growth rate\b/i, ""); }
  else part = whole;
  if (/^(?:change|net change|increase|decrease|% change|change from)$/i.test(whole) && !percent) notes.drop = true;
  // Sentences: "In Mexico, comp sales", "Compared to last year's fourth quarter, revenues", "Herradura's net sales".
  const inPlace = /^In ([A-Z][\w&.' -]{1,40}?),\s+(.+)$/.exec(part);
  if (inPlace) { notes.scopes.push(inPlace[1].replace(/^the\s+/i, "")); part = inPlace[2]; }
  part = part.replace(/^(?:first|second|third|fourth)[- ]quarter\s+/i, "").replace(/^(?:compared (?:to|with)|versus|vs\.?) [^,]+,\s*/i, "").replace(/^(?:for|in) the (?:first|second|third|fourth) quarter,?\s*/i, "")
    .replace(/^(?:first|second|third|fourth) quarter(?:'s)?\s+/i, "").replace(/\s+in the (?:first|second|third|fourth) quarter$/i, "").replace(/^q[1-4]\s+/i, "")
    .replace(/^on a [^,]+ basis,\s*/i, "");
  const owner = /^([A-Z][\w&.-]*(?:\s+[A-Za-z][\w&.-]*){0,4})['’]s\s+(.+)$/.exec(part);
  // Only when what follows is a measure: "Sam's Club U.S." is a name, not Sam's.
  // And not when a capital follows: "Sam's Club comparable sales" is Sam's Club's.
  if (owner && !STRONG_MEASURE.test(owner[1]) && STRONG_MEASURE.test(owner[2]) && !/^[A-Z][a-z]/.test(owner[2])) { notes.scopes.push(owner[1]); part = owner[2]; }
  part = part.replace(/^number of\s+/i, "").replace(/\breported\s+(?=sales|revenue)/i, "");
  // A heading printed in parentheses, left once its change is taken off: "Growth Rate (Square Footage)".
  return clean(clean(part).replace(/^\(([^()]+)\)$/, "$1"));
}

/** A caption names a business by its heading: "Walmart U.S. Segment" is Walmart U.S.'s. */
const captionScope = (text: string) => clean(text.replace(/\s*\([^)]*\)/g, " ").replace(/^table \d+\.?\s*/i, "").replace(/\s+(?:segment|division|business)?\s*(?:results(?: of operations)?|operating (?:metrics|results|data|statistics|highlights)|highlights|metrics|statistics|information|data|summary)$/i, "").replace(/\s+(?:segment|division|reportable segment)s?$/i, ""));

/**
 * The operating vocabulary, word by word: it is written to find rows ("subscri", "propert"), and inside a name it
 * would find "ton" in Boston and "homes" in HomeSense. A business's name in one word ("HomeSense") or a line of
 * insurance ("Property") is whose, not what.
 */
const operatingWord = (part: string) => part.split(/[\s/-]+/).some((word) => {
  const found = OPERATING.exec(word);
  return !!found && found.index === 0 && !/[a-z][A-Z]/.test(word) && !/^property$/i.test(word);
});

const kind = (part: string): "measure" | "scope" => {
  if (STRONG_MEASURE.test(part)) return "measure";
  if (GEOGRAPHY.test(part) || /['’]s\b/.test(part)) return "scope";
  return operatingWord(part) ? "measure" : "scope";
};

const lowerFirst = (text: string) => (/^[A-Z][a-z]+\b/.test(text) && !/^[A-Z][a-z]+[A-Z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text);

/** Revenue or sales, plain: the statements' figure, not an operating one. */
const PLAIN_REVENUE = /^(?:total |net |gross |consolidated |company |reported |gaap )*(?:net )?(?:revenues?|sales)(?: to external customers)?(?:,? net)?(?: by segment)?$/i;

export function describeKpi(parts: KpiParts): KpiDescription | null {
  const notes: Notes = { scale: null, ownScale: null, cents: false, percent: false, dollars: false, tableDollars: false, suffix: null, qualifiers: [], basis: null, scopes: [], drop: false };
  // A caption's aside does not make its table a reconciliation: "Products Pipelines (including reconciliation of …)".
  const raw = [parts.caption?.replace(/\([^)]*\)/g, " "), parts.section, parts.label, parts.measure].filter((text): text is string => !!text && /[a-z]/i.test(text));
  if (raw.some((text) => NOT_A_KPI.test(text))) return null;
  // The unit printed may be wrong; whether it is a rate decides what a trailing "change" means.
  const printedPercent = parts.unit === "percent";
  const pieces: Array<{ role: "caption" | "section" | "label" | "measure"; text: string }> = [];
  const add = (role: "caption" | "section" | "label" | "measure", text: string | null | undefined) => {
    if (!text) return;
    const [scaleBefore, dollarsBefore] = [notes.scale, notes.dollars];
    let part = strip(tidyName(text), notes, printedPercent || role === "measure" && /growth|change/i.test(text));
    if (role === "label" || role === "measure") { if (notes.scale !== scaleBefore) notes.ownScale = notes.scale; }
    else if (notes.dollars && !dollarsBefore) { notes.dollars = false; notes.tableDollars = true; }
    // A caption of generic words only ("Financial and Operational Highlights") says nothing of whose or what.
    if (role === "caption" && /^(?:(?:financial|operating|operational|key|selected|other|supplemental|business|quarterly|summary|consolidated)(?:,?\s+and\s+|\s+|,\s*))+(?:data|metrics|statistics|information|highlights|results)$/i.test(part)) return;
    if (role === "caption") part = captionScope(part);
    if (!part || !/[a-z]{2}/i.test(part) || /^(?:by|of|in|for|and|or|the|from|to)$/i.test(part)) return;
    // A column of units ("Unit", "MBOED") heading the table is not what it is about.
    if (role === "caption" && /^units?$/i.test(part)) return;
    if (WHOLE.test(part) || (role === "caption" && /\bconsolidated\b|\btotal company\b/i.test(part) && CONTAINER.test(part.replace(/\bconsolidated\s+/i, "")))) { notes.scopes.unshift("Total"); return; }
    if (CONTAINER.test(part) || (/\b(?:data|metrics|statistics|information|highlights)$/i.test(part) && !STRONG_MEASURE.test(part))) return;
    // A period, not a subject: "Second Quarters", "Q2 FY27", "Three months".
    if (/^(?:(?:first|second|third|fourth) quarters?|q[1-4](?: fy\d+)?|(?:three|six|nine|twelve) months|(?:current|prior) (?:month|quarter|period|year)|(?:19|20)\d\d)$/i.test(part)) return;
    pieces.push({ role, text: part });
  };
  add("caption", parts.caption);
  add("section", parts.section);
  add("label", parts.label);
  add("measure", parts.measure);
  if (notes.drop) return null;
  for (const scope of notes.scopes.filter((scope) => scope !== "Total")) pieces.unshift({ role: "caption", text: scope });
  // A piece another one says in full is said once: "Video" in "Total Video Customers", "Homes" in "Homes closed".
  const unique = pieces.filter((piece, index) => !pieces.some((other, at) => at !== index && (
    (subset(words(piece.text), words(other.text)) && (words(piece.text).size < words(other.text).size || at > index)))));
  // A caption that names a measure is the heading of a part of the text ("Membership Fees" over Costco's paid members):
  // it is dropped when the rows say their own measure.
  const ownMeasure = unique.some((piece) => piece.role !== "caption" && STRONG_MEASURE.test(piece.text));
  const measures = unique.filter((piece) => kind(piece.text) === "measure" && !(piece.role === "caption" && ownMeasure && !notes.scopes.includes(piece.text)))
    .map((piece) => ({ ...piece, text: sentenceCase(piece.text) }));
  if (!measures.length) return null;
  // A business's name keeps its capitals ("Walmart International"); only one printed in capitals is put in sentence case.
  const scopes = unique.filter((piece) => kind(piece.text) === "scope").map((piece) => (/[a-z]/.test(piece.text) || !piece.text.includes(" ") ? piece.text : sentenceCase(piece.text)));
  if (notes.scopes.includes("Total") && !scopes.length) scopes.push("Total");
  // Of several measures, a heading that names a family ("Combined ratios") over one of it ("Loss ratio") is left out.
  const main = measures.at(-1)!.text;
  const context = measures.slice(0, -1).map((piece) => piece.text).filter((text) => !(/(?:ratios|metrics|statistics|volumes|prices|data|results)$/i.test(text) && words(main).size > 0));
  let measure = [...context, main].join(" · ")
    .replace(/\bcomp(?:arable)? sales\b/gi, (match) => (/^C/.test(match) ? "Comparable sales" : "comparable sales"))
    .replace(/\bcomps\b/gi, "comparable sales").replace(/\bSSS\b/g, "same-store sales").replace(/^WW\b/, "Worldwide");
  // Whose it is, before what it is when it is short: "Walmart U.S. comparable sales"; after it otherwise.
  const scope = [...new Set(scopes.map((text) => text.replace(/\s+segment$/i, "").replace(/^WW$/, "Worldwide")))].join(", ");
  const scopeWords = new Set(scope.toLowerCase().split(/\s+/));
  while (scope && measure.includes(" ") && scopeWords.has(measure.split(" ")[0].toLowerCase())) measure = measure.slice(measure.indexOf(" ") + 1);
  measure = measure[0].toUpperCase() + measure.slice(1);
  const core = !scope ? measure : scope.length <= 30 && scopes.length <= 2 && !measure.includes(" · ") ? `${scope} ${lowerFirst(measure)}` : `${measure} · ${scope}`;
  const qualifiers = [...new Set(notes.qualifiers)];

  // The unit, from what is measured.
  const said = `${main} ${parts.label} ${parts.section ?? ""} ${parts.measure ?? ""}`;
  let unit: KpiUnit = parts.unit;
  let scale = notes.scale && notes.scale !== "trillions" && parts.scale ? parts.scale : notes.scale ?? parts.scale;
  let suffix = notes.suffix;
  const values = parts.values ?? [];
  const small = values.length > 0 && values.every((value) => Math.abs(value) < 1000);
  // What is measured is said by the main measure, or by the heading over it when the main one is a line or a business
  // ("Mobility subscribers · Postpaid"); and a ratio is measured as its numerator is: DARTs per account are trades.
  const subject = COUNTED.test(main) || MONEY.test(main) || RATE.test(main) ? main : measure;
  const numerator = subject.split(/\s+per\s+/i)[0];
  if (notes.cents) { unit = "count"; suffix = "¢"; }
  else if (notes.percent || (unit !== "percent" && RATE.test(subject) && !/\bper\b|\bprice|\bcost\b/i.test(subject) && !COUNTED.test(subject.replace(RATE, "")) && small && !notes.dollars)) unit = "percent";
  else if (/square f(?:ee|oo)t|footage|\bsq\.? ?ft\b|\brsf\b/i.test(numerator) && !/\brent|\bsales\b|revenue|growth/i.test(main) && unit !== "percent") { unit = "count"; suffix = "sq ft"; }
  else if (notes.dollars && unit !== "percent") unit = "currency";
  else if (/\bprices?\b|\bcosts?\b|revenue/i.test(numerator) && unit === "count") { unit = "currency"; suffix = null; }
  // Barrels, cubic feet and watt-hours are counted, whatever the table's "$" (Kinder Morgan's leasable capacity in MMBbl).
  else if (suffix && !suffix.startsWith("/") && unit === "currency") { unit = "count"; scale = notes.ownScale; }
  // A count in a table of amounts: the table's "$" and its "in millions" are said of the amounts, not of it.
  // A table "in millions" counts in millions (Uber's MAPCs); one in "U.S. dollars in millions" does not (TJX's stores).
  else if (unit === "currency" && COUNTED.test(numerator) && !MONEY.test(numerator)) { unit = "count"; scale = notes.ownScale ?? (!parts.dollarScale || scale === "thousands" ? scale : null); }
  else if (notes.tableDollars && unit !== "percent" && !COUNTED.test(numerator)) unit = "currency";
  else if (unit === "count" && MONEY.test(numerator) && !COUNTED.test(numerator) && !notes.suffix && !/\bnumber\b|\bcount\b/i.test(said)) unit = "currency";
  // Under a heading "Revenues", a line of business is an amount: MGM's "Revenues · Rooms".
  if (unit === "count" && context.some((text) => /^(?:total |net )?(?:revenues?|sales)$/i.test(text.trim()))) unit = "currency";
  // A count is not in the trillions: the table's "in millions" was said of its amounts (Arch's policies in force).
  if (unit === "count" && scale && suffix !== "sq ft" && values.some((value) => Math.abs(value) * ({ thousands: 1e3, millions: 1e6, billions: 1e9 }[scale!] ?? 1) > 5e10)) scale = null;
  if (unit === "percent") scale = null;
  // A price read as a rate: a hotel's average daily rate of $254, Norwegian's net yield of $341 a day.
  if (unit === "percent" && values.length > 0 && values.every((value) => value > 200) && (MONEY.test(main) || /\byield\b/i.test(main))) { unit = "currency"; scale = null; }
  // A rate the figures cannot be: NVIDIA's warranty "Utilization" of (401).
  if (unit === "percent" && (values.some((value) => Math.abs(value) > 200) || (LEVEL.test(main) && !/ratio|margin/i.test(main) && values.some((value) => value < 0)))) return null;
  if (unit === "count" && !suffix) suffix = NOUNS.find(([pattern]) => pattern.test(numerator))?.[1] ?? null;
  // Places are not counted in millions: PNC's 2,302 branches under a table "in millions".
  if (unit === "count" && (scale === "millions" || scale === "billions") && /^(?:stores|restaurants|warehouses|clubs|branches|properties|rooms)$/.test(suffix ?? "") && !notes.ownScale) scale = null;
  // An amount must say what it is: "Subscription", "Aircraft manufacturing" or "Client and gaming" alone is a line of
  // business, its revenue the SEG panel's and not a KPI.
  if (unit === "currency" && !STRONG_MEASURE.test(measure) && !MONEY.test(measure)) return null;
  // Revenue is the statements' figure; its growth by a named line of business, at constant currency or organic is not.
  if (PLAIN_REVENUE.test(main) && (unit !== "percent" || ((!scope || scope === "Total") && !qualifiers.includes("constant currency")))) return null;
  if (unit === "currency" && /^(?:revenues?|sales)\b/i.test(main) && !COMPARABLE.test(main) && !/\bper\b/i.test(main)) return null;

  // The basis: a figure in per cent that is not itself a rate is a change; a comparable figure is always one.
  let basis = notes.basis;
  if (unit === "percent" && !basis && (COMPARABLE.test(measure) || /organic|growth/i.test(measure) || !LEVEL.test(measure))) basis = "y/y";
  if (unit !== "percent" && basis === "y/y") basis = null;
  const name = `${core}${qualifiers.length ? `, ${qualifiers.join(", ")}` : ""}${basis ? ` · ${basis}` : ""}`.replace(/\s{2,}/g, " ").trim()
    .replace(/\brevpar\b/gi, "RevPAR").replace(/\badr\b/gi, "ADR").replace(/\barp([ua])\b/gi, (_, letter: string) => `ARP${letter.toUpperCase()}`).replace(/\bdarts\b/gi, "DARTs");
  return { name, unit, scale, suffix };
}

/** A name as a card can hold it: Amazon's "Net sales -- Y/Y growth, excluding F/X" is its "Net sales · growth ex-FX". */
export function tidyName(name: string): string {
  return name
    .replace(/\s+--\s+/g, " · ")
    .replace(/\bTTM Y\/Y growth(?: \(decline\))?,? excluding F\/X\b/gi, "TTM growth ex-FX")
    .replace(/\bY\/Y growth(?: \(decline\))?,? excluding F\/X\b/gi, "growth ex-FX")
    .replace(/\bF\/X Neutral Y\/Y % Growth\b/gi, "growth ex-FX")
    .replace(/\bY\/Y (?:% )?growth(?: \(decline\))?\b/gi, "growth")
    .replace(/\s*\((?:full-time and part-time; )?excludes contractors (?:&|and) temporary personnel\)/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
