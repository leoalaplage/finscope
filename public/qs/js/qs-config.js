// =====================================================================
//  QS Screener - Configuration
//  Port fidele de qs_config.py. C'est ICI qu'on regle le systeme de
//  notation : poids, sens, ancres, alertes, seuils.
//  Toute modification doit rester synchronisee avec qs_config.py.
// =====================================================================

export const PILIERS = ["Quality", "Health", "Growth", "Value"];

// ---------------------------------------------------------------------
// 1) Poids des piliers (total = 100)
// ---------------------------------------------------------------------
export const POIDS_PILIERS = {
  Quality: 45,
  Health: 20,
  Growth: 15,
  Value: 20,
};

export const PRESETS = {
  "defaut": { Quality: 45, Health: 20, Growth: 15, Value: 20 },
  "quality-purist": { Quality: 55, Health: 20, Growth: 10, Value: 15 },
  "value-aware": { Quality: 35, Health: 20, Growth: 15, Value: 30 },
};

// ---------------------------------------------------------------------
// 2) Definition des metriques
//    sens : "H" = plus haut = mieux, "L" = plus bas = mieux
//    entetes : noms de colonnes acceptes (casse/accents/espaces ignores)
// ---------------------------------------------------------------------
export const METRIQUES = [
  // ---- QUALITY ----
  { cle: "ROIC", pilier: "Quality", poids: 10, sens: "H",
    entetes: ["ROIC (%)", "ROIC", "Return on Invested Capital"] },
  { cle: "ROIC5", pilier: "Quality", poids: 15, sens: "H",
    entetes: ["ROIC 5a moy (%)", "ROIC 5Yr Avg", "ROIC 5a"] },
  { cle: "OpM", pilier: "Quality", poids: 15, sens: "H",
    entetes: ["Marge oper. (%)", "Marge operationnelle", "Operating Margin", "Marge oper"] },
  { cle: "FCFM5", pilier: "Quality", poids: 15, sens: "H",
    entetes: ["Marge FCF 5a (%)", "FCF Margin 5Yr Avg", "Free Cash Flow Margin"] },
  { cle: "FCF_NI", pilier: "Quality", poids: 10, sens: "H",
    entetes: ["FCF/Res. net (%)", "FCF / Net Income", "FCF/Net Income"] },
  { cle: "GM5", pilier: "Quality", poids: 5, sens: "H",
    entetes: ["Marge brute 5a (%)", "Gross Margin 5Yr Avg", "Gross Profit Margin"] },
  /*
   * How straight the free-cash-flow-per-share line is, on a log scale.
   *
   * The growth pillar already asks how fast that figure compounded. This asks
   * whether it compounded at all or merely arrived: two companies at twelve per
   * cent a year, one a step a year and the other a collapse and a recovery, are
   * not the same business, and only the first is one a reader can extrapolate
   * from. It is a quality of the earnings rather than a rate of them, which is
   * why it sits here and not beside the CAGR it qualifies.
   *
   * FinScope computes it for every company it holds. A pasted table that has no
   * such column simply puts the metric out of the universe's reach, as the
   * engine already does for any measure nobody carries, and the remaining
   * weights answer for the pillar.
   */
  { cle: "FCFPS_R2", pilier: "Quality", poids: 10, sens: "H",
    entetes: ["FCF/Share 5Y R2", "FCF Per Share 5Y R2", "FCF/action R2 5a"] },
  { cle: "ShOut5", pilier: "Quality", poids: 10, sens: "L",
    entetes: ["Dilution actions 5a (%)", "Shares Outstanding 5Y CAGR", "Dilution",
              "Shares Out Growth 5Y (CAGR)", "Shares Out Growth 5Y"] },
  { cle: "SBC", pilier: "Quality", poids: 10, sens: "L",
    entetes: ["SBC/CA (%)", "SBC to Revenue", "SBC/CA", "Stock-based Comp to Revenue"] },

  // ---- HEALTH ----
  { cle: "NetDebtEBITDA", pilier: "Health", poids: 35, sens: "L",
    entetes: ["Dette nette/EBITDA", "Net Debt / EBITDA", "Net Debt/EBITDA"] },
  { cle: "EBITInt", pilier: "Health", poids: 35, sens: "H",
    entetes: ["EBIT/Interets", "EBIT / Interest Expense", "EBIT/Interest"] },
  { cle: "CurrentRatio", pilier: "Health", poids: 5, sens: "H",
    entetes: ["Current ratio", "Current Ratio"] },
  { cle: "LTDebtAssets", pilier: "Health", poids: 10, sens: "L",
    entetes: ["Dette LT/Actifs", "Long-term Debt to Assets", "LT Debt to Assets"] },
  { cle: "OCF_Capex", pilier: "Health", poids: 15, sens: "H",
    entetes: ["OCF/Capex", "Capex Coverage (OCF/Capex)", "Capex Coverage"] },

  /* ---- GROWTH ----
   *
   * Aucune serie ne porte plus d'un tiers du pilier.
   *
   * La croissance du free cash flow et celle du free cash flow par action
   * pesaient 15 et 25 : quarante des quatre-vingts points reellement mesurables
   * du pilier, sur une seule serie. Or un seul exercice a flux negatif — un
   * creux cyclique, une annee 2020 — rend les deux taux indefinis d'un coup, et
   * le pilier tombait a la moitie de lui-meme au moment precis ou un lecteur
   * veut savoir ce que la societe a fait de ce creux. Booking, Exxon, Palantir
   * et Intel s'y retrouvaient tous entre 38 et 50 %.
   *
   * Le chiffre d'affaires, lui, n'est jamais negatif : ses deux mesures ne
   * tombent jamais ensemble. L'asymetrie est dans la donnee, pas dans le
   * jugement, et le poids en tient compte desormais — le FCF par action reste
   * la mesure la plus lourde du pilier, sans que sa jumelle en fasse la moitie.
   */
  { cle: "Rev5", pilier: "Growth", poids: 12, sens: "H",
    entetes: ["CA CAGR 5a (%)", "Revenue 5Y CAGR", "Revenue 5Y"] },
  { cle: "RevFwd3", pilier: "Growth", poids: 20, sens: "H",
    entetes: ["CA fwd 3a (%)", "Revenue Forward 3Y CAGR", "Revenue Forward 3Y"] },
  { cle: "LevFCF5", pilier: "Growth", poids: 6, sens: "H",
    entetes: ["FCF CAGR 5a (%)", "Levered FCF 5Y CAGR", "FCF 5Y CAGR",
              "Levered Free Cash Flow 5Y CAGR"] },
  { cle: "NI5", pilier: "Growth", poids: 9, sens: "H",
    entetes: ["Res.net CAGR 5a (%)", "Net Income 5Y CAGR", "Net Income 5Y"] },
  // derivees : CAGR de la metrique corrige du CAGR du nombre d'actions
  { cle: "RevPS5", pilier: "Growth", poids: 9, sens: "H",
    // Sans en-tete, cette metrique ne pouvait etre fournie par aucune source :
    // ni une exportation collee, ni la table que FinScope genere. Elle pesait
    // 15 points du pilier Growth qu'aucun titre ne pouvait jamais gagner.
    entetes: ["CA/action CAGR 5a (%)", "Revenue Per Share 5Y CAGR", "Revenue per Share 5Y CAGR", "Revenue/Share 5Y CAGR"] },
  /*
   * La meme croissance, sur la fenetre longue.
   *
   * Cinq ans a partir de 2020 mesure une reprise, pas une croissance : Booking
   * sort a +31,7 %/an de chiffre d'affaires et +146,8 %/an de resultat net
   * parce que son exercice 2020 est un cratere — sur dix ans la meme societe
   * fait +11,3 % et +7,8 %. Tout un secteur est dans ce cas : voyage,
   * hotellerie, aerien, energie.
   *
   * Aucune moyenne ne repare ca. La moitie de 147 % plafonne encore l'ancre.
   * Les deux fenetres sont donc notees separement et une societe doit tenir sur
   * les deux : ce qui n'existe que sur une seule est un rebond, et un rebond
   * vaut la moitie des points d'une croissance etablie.
   *
   * Une table collee qui ne porte pas ces colonnes les met simplement hors de
   * portee de son univers, comme le moteur le fait deja pour toute mesure que
   * personne ne porte.
   */
  { cle: "Rev10", pilier: "Growth", poids: 8, sens: "H",
    entetes: ["CA CAGR 10a (%)", "Revenue 10Y CAGR", "Revenue 10Y"] },
  { cle: "NI10", pilier: "Growth", poids: 6, sens: "H",
    entetes: ["Res.net CAGR 10a (%)", "Net Income 10Y CAGR", "Net Income 10Y"] },
  { cle: "LevFCF10", pilier: "Growth", poids: 4, sens: "H",
    entetes: ["FCF CAGR 10a (%)", "Levered FCF 10Y CAGR", "FCF 10Y CAGR"] },
  { cle: "RevPS10", pilier: "Growth", poids: 6, sens: "H",
    entetes: ["CA/action CAGR 10a (%)", "Revenue Per Share 10Y CAGR", "Revenue/Share 10Y CAGR"] },
  { cle: "FCFPS10", pilier: "Growth", poids: 8, sens: "H",
    entetes: ["FCF/action CAGR 10a (%)", "FCF Per Share 10Y CAGR", "FCF/Share 10Y CAGR"] },
  { cle: "FCFPS5", pilier: "Growth", poids: 12, sens: "H",
    // Idem, et c'est la metrique la plus lourde du pilier : la croissance du
    // free cash flow par action est ce que la dilution rend visible ou non.
    entetes: ["FCF/action CAGR 5a (%)", "FCF Per Share 5Y CAGR", "Free Cash Flow Per Share 5Y CAGR", "FCF/Share 5Y CAGR"] },

  // ---- VALUE ----
  { cle: "EV_EBIT", pilier: "Value", poids: 35, sens: "L",
    entetes: ["EV/EBIT", "EV / EBIT"] },
  { cle: "EV_FCF", pilier: "Value", poids: 15, sens: "L",
    entetes: ["EV/FCF", "EV / FCF"] },
  { cle: "FwdP_FCF", pilier: "Value", poids: 25, sens: "L",
    entetes: ["P/FCF fwd", "Forward P/FCF", "P/FCF forward"] },
  { cle: "FCFYield", pilier: "Value", poids: 25, sens: "H",
    entetes: ["FCF Yield (%)", "FCF Yield", "FCF Yield %"] },
];

// ---------------------------------------------------------------------
// 3) Colonnes d'identification / de reference
// ---------------------------------------------------------------------
export const COLONNE_TICKER = ["Ticker", "Symbole", "Symbol"];
export const COLONNE_SECTEUR = ["Secteur", "Sector"];
export const COLONNE_CAP = ["Cap. boursiere ($Md)", "Market Cap", "Cap boursiere", "MarketCap"];

export const COLONNES_REFERENCE = [
  { cle: "PEG", entetes: ["PEG (ref.)", "PEG", "PEG Ratio"] },
  { cle: "OCF", entetes: ["OCF ($Md)", "OCF", "Cash from Operations", "Operating Cash Flow"] },
  { cle: "Capex", entetes: ["Capex ($Md)", "Capex", "Capital Expenditure", "Capital Expenditures"] },
];

// ---------------------------------------------------------------------
// 4) Winsorisation et plafonds economiques
// ---------------------------------------------------------------------
export const WINSOR_BAS = 2.5;
export const WINSOR_HAUT = 97.5;

// Au-dela de ces valeurs, "plus haut" n'est plus "meilleur".
export const PLAFONDS = {
  FCF_NI: 130,     // conversion de cash plafonnee a 130 %
  OCF_Capex: 15,   // couverture du capex plafonnee a 15x
  EBITInt: 40,     // couverture d'interets plafonnee a 40x
};

// ---------------------------------------------------------------------
// 4bis) Reglages "v3"
// ---------------------------------------------------------------------
export const NOMS_METRIQUES = {
  ROIC: "ROIC", ROIC5: "ROIC 5y", OpM: "Operating margin",
  FCFM5: "FCF margin 5y", FCF_NI: "FCF/Net income conv.", GM5: "Gross margin",
  FCFPS_R2: "FCF/share consistency", ShOut5: "Low dilution", SBC: "Low SBC/Revenue",
  NetDebtEBITDA: "Low leverage", EBITInt: "High interest coverage",
  CurrentRatio: "Strong current ratio", LTDebtAssets: "Low LT debt",
  OCF_Capex: "Capex coverage",
  Rev5: "Revenue growth 5y", RevFwd3: "Fwd revenue growth", LevFCF5: "FCF growth 5y",
  NI5: "Net income growth 5y",
  RevPS5: "Revenue/share growth 5y", FCFPS5: "FCF/share growth 5y",
  Rev10: "Revenue growth 10y", NI10: "Net income growth 10y", LevFCF10: "FCF growth 10y",
  RevPS10: "Revenue/share growth 10y", FCFPS10: "FCF/share growth 10y",
  EV_EBIT: "Attractive EV/EBIT", EV_FCF: "Attractive EV/FCF",
  FwdP_FCF: "Attractive P/FCF fwd", FCFYield: "FCF yield",
};

export const DESCRIPTIONS_METRIQUES = {
  ROIC: "Return on invested capital: after-tax profit per $ of capital deployed. Core quality marker.",
  ROIC5: "5-year average ROIC: shows whether high returns are durable, not a one-off.",
  OpM: "Operating margin: operating profit / revenue. Pricing power and cost discipline.",
  FCFM5: "5-year average free-cash-flow margin: FCF / revenue. How much cash the model throws off.",
  FCF_NI: "Cash conversion: free cash flow / net income. >100% = earnings are backed by real cash.",
  GM5: "5-year average gross margin (low weight: strongly sector-biased, 100% is often an artefact).",
  FCFPS_R2: "R\u00b2 of free cash flow per share against time, on a log scale over five years. 1 = it compounded in a straight line; low = it arrived by luck.",
  ShOut5: "Share count 5y CAGR. Lower/negative = buybacks, no dilution (scored inverted).",
  SBC: "Stock-based comp / revenue. Hidden cost of equity pay; lower is better (scored inverted).",
  NetDebtEBITDA: "Net debt / EBITDA. Balance-sheet leverage; lower is safer (scored inverted).",
  EBITInt: "Interest coverage: EBIT / interest expense. How easily debt interest is paid.",
  CurrentRatio: "Current ratio: current assets / current liabilities. Short-term solvency.",
  LTDebtAssets: "Long-term debt / assets. Structural indebtedness; lower is better (scored inverted).",
  OCF_Capex: "Capex coverage: operating cash flow / capex. >1 = self-funding of investments.",
  Rev5: "Revenue 5-year CAGR. Historical top-line growth.",
  RevFwd3: "Expected revenue 3-year forward CAGR (analyst estimates).",
  LevFCF5: "Levered free cash flow 5-year CAGR. Growth of the cash that actually reaches shareholders.",
  NI5: "Net income 5-year CAGR. Bottom-line growth.",
  Rev10: "Revenue 10-year CAGR. The long window, which a five-year one starting at a trough cannot see past.",
  NI10: "Net income 10-year CAGR.",
  LevFCF10: "Levered free cash flow 10-year CAGR.",
  RevPS10: "Revenue per share 10-year CAGR.",
  FCFPS10: "FCF per share 10-year CAGR. Growth that exists on five years and not on ten is a recovery.",
  RevPS5: "Revenue growth adjusted for changes in share count. How much top-line growth accrues per share.",
  FCFPS5: "FCF growth adjusted for changes in share count. The cash growth that actually accrues per share.",
  EV_EBIT: "EV / EBIT. Enterprise value vs operating profit; lower is cheaper (scored inverted).",
  EV_FCF: "EV / free cash flow. Cheapness on a cash basis; lower is better (scored inverted).",
  FwdP_FCF: "Forward price / free cash flow. Forward-looking cheapness; lower is better (scored inverted).",
  FCFYield: "FCF yield: free cash flow / market cap. Higher = more cash return for the price paid.",
};

// Note-lettre sur le TOTAL (bornes basses, ordre decroissant).
//
// Relue pour une echelle absolue. Sur un percentile, 50 etait la mediane de la
// table par construction et la grille se calait dessus. Ici 50 veut dire
// "solide sur a peu pres tout", et la lettre traduit ce jugement : B = solide,
// A = nettement au-dessus, A+ = exceptionnel, D = casse. Une societe ne change
// plus de lettre parce qu'on a note quelqu'un d'autre en meme temps.
export const GRILLE_NOTES = [
  ["A+", 78], ["A", 68], ["A-", 60],
  ["B+", 52], ["B", 45], ["B-", 38],
  ["C", 30], ["D", 0],
];

export const MALUS_ALERTE = 2.5;
export const SEUIL_COUVERTURE = 0.75;
export const SEUIL_FORCE = 70;
export const SEUIL_FAIBLESSE = 30;
export const NB_FORCES = 3;
export const SECTEUR_MIN = 3;

// ---------------------------------------------------------------------
// 4ter) Marqueur de VALORISATION
// ---------------------------------------------------------------------
export const NIVEAUX_VALUATION = [
  ["Attractive", 66],
  ["Fair", 40],
  ["Expensive", 0],
];

export const SWEET_SPOT_QUALITE = 60;
export const SWEET_SPOT_SANTE = 50;

// ---------------------------------------------------------------------
// 4quater) Scoring absolu
//
// La note ne depend pas de la compagnie qu'on lui donne. Une metrique est
// jugee contre une echelle fixe, pas contre les autres titres de la table :
// le meme ROIC vaut le meme score qu'il soit note seul, dans une watchlist de
// trois lignes ou dans le S&P 500 entier. Un classement par percentile
// repondait a une autre question — "qui est le meilleur ici" — et rendait la
// note d'une societe dependante de ses voisins : une valorisation chere
// obtenait 98 sur 100 des lors que le reste de la table etait plus cher
// encore.
//
// Les percentiles restent calcules (le screener classe encore une table), ils
// n'entrent simplement plus dans la note.
// ---------------------------------------------------------------------
export const MELANGE_RELATIF = 0.0;
export const MELANGE_ABSOLU = 1.0;
export const PERCENTILE_SECTORIEL = false;

// Ancres absolues : [valeur notee 0, valeur notee 50, valeur notee 100].
//
// Trois points, pas deux. Une droite entre "mauvais" et "excellent" ecrase le
// milieu, la ou se trouvent presque toutes les societes : la moitie de
// l'univers touchait 100 sur la couverture d'interets et personne ne bougeait
// entre 20x et 400x. Le point median dit ce qu'une bonne societe cotee affiche
// vraiment, et la note se lit alors comme un jugement — 50 = solide,
// 100 = exceptionnel, 0 = casse — et non comme un rang.
//
// Ces bornes sont des conventions d'analyse, pas des statistiques tirees d'une
// table : c'est ce qui rend la note independante de la compagnie notee a cote.
export const ANCRES_ABSOLUES = {
  // Quality
  ROIC: [5, 15, 35],          // 15 % couvre le cout du capital ; 35 % est rare et durable
  ROIC5: [5, 15, 30],         // tenu cinq ans, 30 % est le haut du panier
  OpM: [3, 18, 45],
  FCFM5: [0, 12, 35],
  FCF_NI: [40, 90, 115],      // au-dela de 100 %, le resultat est integralement encaisse
  GM5: [15, 45, 80],
  // Trois points ordinaires d'un ajustement log-lineaire : 0,55 est un nuage,
  // 0,85 une vraie tendance bruitee, 0,97 la droite d'un compositeur regulier.
  FCFPS_R2: [0.55, 0.85, 0.97],
  ShOut5: [3, 0, -3],         // 0 = nombre d'actions stable ; 100 = 3 %/an rachetes
  SBC: [12, 4, 0.5],

  // Health
  NetDebtEBITDA: [4, 1.5, 0], // 0 ou tresorerie nette = 100
  EBITInt: [3, 15, 40],
  CurrentRatio: [0.7, 1.3, 2.5],
  LTDebtAssets: [0.5, 0.2, 0.02],
  OCF_Capex: [0.8, 2.5, 10],

  // Growth
  Rev5: [0, 8, 25],
  RevFwd3: [0, 7, 20],
  LevFCF5: [0, 8, 25],
  NI5: [0, 8, 25],
  RevPS5: [0, 7, 22],
  FCFPS5: [0, 8, 25],
  // Dix ans compose plus bas que cinq pour presque toute societe : les ancres
  // le disent, sinon la fenetre longue punirait tout le monde.
  Rev10: [0, 7, 20],
  NI10: [0, 7, 20],
  LevFCF10: [0, 7, 20],
  RevPS10: [0, 6, 18],
  FCFPS10: [0, 7, 20],

  // Value
  EV_EBIT: [40, 20, 10],
  EV_FCF: [70, 30, 14],
  FwdP_FCF: [55, 25, 12],
  FCFYield: [0, 3.5, 8],
};

// Multiples de valorisation : une valeur negative est absurde, jamais "pas chere".
export const NEGATIF_PIRE = new Set(["EV_EBIT", "EV_FCF", "FwdP_FCF"]);

// ---------------------------------------------------------------------
// 5) Regles d'alertes : [libelle, cle, operateur, seuil]
// ---------------------------------------------------------------------
export const REGLES_ALERTES = [
  ["High share dilution", "ShOut5", ">", 0],
  ["High SBC/Revenue (>8%)", "SBC", ">", 8],
  ["High leverage (>2.5x)", "NetDebtEBITDA", ">", 2.5],
  ["Expensive EV/FCF (>40x)", "EV_FCF", ">", 40],
  ["Low forward growth (<8%)", "RevFwd3", "<", 8],
];

// ---------------------------------------------------------------------
// 6) Secteurs par defaut (equivalent de secteurs.csv)
//    Utilise uniquement si le CSV colle n'a pas de colonne Secteur.
// ---------------------------------------------------------------------
export const SECTEURS_DEFAUT = {
  NVDA: "Semiconductors", AMAT: "Semiconductors", LRCX: "Semiconductors",
  KLAC: "Semiconductors", ASML: "Semiconductors",
  AAPL: "Tech Hardware", ANET: "Tech Hardware",
  MSFT: "Software", ADBE: "Software", NOW: "Software", FTNT: "Software",
  VEEV: "Software", FICO: "Software", DSY: "Software", CSU: "Software",
  GOOGL: "Media", META: "Media",
  V: "Financials", MA: "Financials", MCO: "Financials", CME: "Financials",
  ICE: "Financials", MSCI: "Financials", FDS: "Financials", SPGI: "Financials",
  MORN: "Financials", CBOE: "Financials",
  "NOVO B": "Healthcare", ISRG: "Healthcare",
  BKNG: "Consumer Disc.", "HESA.F": "Consumer Disc.",
  CPRT: "Industrials", FIX: "Industrials",
};
