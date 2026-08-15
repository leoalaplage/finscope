// =====================================================================
//  QS Screener - Rendu PNG du Dashboard et de la Methodology
//  Port de qs_pdf.py sur <canvas>. Meme grille, memes couleurs, memes
//  libelles (rapport 100 % anglais). Difference assumee : le dashboard
//  n'est plus decoupe en pages A4, c'est une seule image a la hauteur
//  du tableau -- plus pratique a copier-coller.
// =====================================================================

import * as cfg from "./qs-config.js";
import { rendre } from "./qs-doc.js";
import { lireEtat } from "./qs-etat.js";

const PILIERS = cfg.PILIERS;
const NOMS_PILIERS_LONG = { Quality: "QUALITY", Health: "HEALTH", Growth: "GROWTH", Value: "VALUE" };

// ---------------------------------------------------------------------
//  Direction artistique AapWire. Couleurs uniquement : la grille, les
//  colonnes, les scores et les regles de classement sont inchanges.
//  Fond navy, texte blanc, secondaire gris bleute, accent bleu, et le
//  vert / rouge / jaune reserves aux resultats positifs, negatifs et aux
//  avertissements.
// ---------------------------------------------------------------------
const BLEU = "rgb(77,163,255)";        // accent
const GRIS = "rgb(11,23,40)";          // surface secondaire (zebrures)
const BLANC = "rgb(243,246,250)";      // texte principal
const GRIS_BORD = "rgb(34,48,71)";     // bordures fines
const NOIR = "rgb(7,17,31)";           // fond
const GRIS_TEXTE = "rgb(148,163,184)"; // texte secondaire

/**
 * Echelle 3 couleurs rouge(0) -> jaune(50) -> vert(100).
 *
 * Les bornes sont celles de la palette AapWire ; la fonction elle-meme est
 * inchangee, donc un score donne occupe exactement la meme position sur
 * l'echelle qu'avant le redesign.
 */
function couleurScore(v) {
  if (v === null || v === undefined) return [26, 43, 68];
  v = Math.max(0, Math.min(100, Number(v)));
  const rouge = [240, 100, 100], jaune = [229, 184, 75], vert = [53, 199, 138];
  const [t, a, b] = v <= 50 ? [v / 50, rouge, jaune] : [(v - 50) / 50, jaune, vert];
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
}

const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

/** Noir ou blanc selon la luminance du fond. */
function texteSur(c) {
  const [r, g, b] = c;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? NOIR : BLANC;
}

const f1 = (x) => (x === null || x === undefined ? "n/a" : Number(x).toFixed(1));

/** Case a coche verte, ou case vide au fond de la ligne. Les traits sont
 *  proportionnels a la hauteur de ligne, pour rester centres si elle change. */
function coche(doc, w, h, actif, zebre) {
  const x0 = doc.x, y0 = doc.y;
  doc.traitCouleur(actif ? NOIR : GRIS_BORD).fondCouleur(actif ? "rgb(53,199,138)" : zebre);
  doc.cell(w, h, "", { fill: true, border: true });
  if (!actif) return;
  const style = { couleur: NOIR, epaisseur: 0.55 };
  doc.ligne(x0 + w * 0.32, y0 + h * 0.52, x0 + w * 0.44, y0 + h * 0.70, style);
  doc.ligne(x0 + w * 0.44, y0 + h * 0.70, x0 + w * 0.70, y0 + h * 0.30, style);
}

// ---------------------------------------------------------------------
// Elements communs
// ---------------------------------------------------------------------
function bandeau(doc, titre, sousTitre = "") {
  doc.fondCouleur(BLEU).texteCouleur(BLANC).police(15, true);
  doc.x = doc.marge;
  doc.cell(doc.epw, 13, titre, { fill: true, padding: 4 });
  doc.ln(13);
  if (sousTitre) {
    //  La ligne de contexte vit dans sa propre bande claire : elle se lit
    //  comme une legende de l'entete, pas comme la premiere ligne du tableau.
    doc.fondCouleur(GRIS).texteCouleur(GRIS_TEXTE).police(8);
    doc.cell(doc.epw, 7, sousTitre, { fill: true, padding: 4 });
    doc.ln(7);
    doc.ligne(doc.marge, doc.y, doc.marge + doc.epw, doc.y, { couleur: GRIS_BORD });
  }
  doc.ln(5);
  doc.texteCouleur(NOIR);
}

function enteteTable(doc, cols, h = 8) {
  //  Les filets de l'entete sont bleus sur bleu : les intitules se separent
  //  sans qu'un quadrillage gris vienne hachurer la bande.
  doc.police(7.5, true).fondCouleur(BLEU).texteCouleur(BLANC).traitCouleur(BLEU);
  doc.x = doc.marge;
  for (const [libelle, w] of cols) doc.cell(w, h, libelle, { align: "C", fill: true, border: true });
  doc.ln(h);
  doc.texteCouleur(NOIR);
}

// ---------------------------------------------------------------------
// Page 1 : DASHBOARD
// ---------------------------------------------------------------------
const COLS = [
  ["Rank", 9, "rank"], ["Ticker", 19, "ticker"], ["Sector", 28, "sector"],
  ["Cap $Bn", 15, "cap"],
  ["Qual", 15, "Quality"], ["Health", 15, "Health"],
  ["Growth", 15, "Growth"], ["Value", 15, "Value"],
  ["TOTAL", 16, "total"], ["Grade", 12, "note"],
  ["Valuation", 23, "valuation"],
  ["R.Adj", 14, "conviction"], ["Data", 12, "data"],
  ["Sect", 12, "sect"], ["Alerts", 12, "alertes"], ["Q+V", 13, "qv"],
  //  Notes de regularite du flux de tresorerie libre, calculees sur la page
  //  FCF. Vides tant que la societe n'y a pas ete analysee : le tableau ne
  //  fabrique jamais un chiffre qu'il n'a pas.
  //  Une seule note visible, et une seule comparaison. Le detail par
  //  fenetre -- 5 ans, 10 ans -- reste dans l'export CSV, ou la place ne
  //  coute rien ; sur l'image, cinq colonnes pour une seule idee noyaient
  //  le reste du tableau.
  ["FCF", 14, "fcf"], ["vs Med", 12, "fcfmed"],
];
const LARGEUR_TABLE = COLS.reduce((a, c) => a + c[1], 0);   // 218 mm
/** Colonnes rendues en aplat colore plutot qu'en texte sur fond de ligne. */
const PAVES = new Set([...PILIERS, "total", "conviction", "data", "valuation", "alertes", "fcf", "fcfmed", "qv"]);

export function dessinerDashboard(retenus, tousTitres, poids, {
  preset = null, echelle = 8, triLibelle = null,
} = {}) {
  // On respecte l'ordre recu : c'est le critere de tri choisi par l'utilisateur.
  // La colonne Rank continue d'afficher le rang dans l'UNIVERS sur le TOTAL --
  // trier par Quality et lire « #6 » en face du premier, c'est justement
  // l'information interessante.
  const titresTri = retenus;
  const aujourdhui = new Date().toISOString().slice(0, 10);
  //  Notes deposees par la page FCF. Absentes tant qu'on n'y est pas passe.
  const notesFcf = lireEtat("fcf.notes", {});

  //  Medianes des notes FCF sur les societes AFFICHEES, pas sur un
  //  univers theorique : la coche repond a « au-dessus de qui ? », et la
  //  seule reponse utile est « des autres lignes du tableau ».
  //  Les societes sans note n'y participent pas -- une absence n'est ni
  //  bonne ni mauvaise, et la compter comme zero abaisserait la mediane
  //  pour tout le monde.
  /** Note unique : moyenne des deux fenetres, ou la seule disponible. */
  const noteFcf = (ticker) => {
    const n = notesFcf[ticker] || {};
    const v = [n.n5, n.n10].filter((x) => x != null && isFinite(x));
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  //  Mediane des notes AFFICHEES. Les societes sans note n'y participent
  //  pas : les compter comme zero abaisserait la barre pour tout le monde.
  const medianeFcf = (() => {
    const v = titresTri.map((t) => noteFcf(t.Ticker))
      .filter((x) => x != null && isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  })();

  const sous =
    `Universe: ${tousTitres.length} stocks   |   shown: ${titresTri.length}   |   weights ` +
    PILIERS.map((p) => `${p} ${poids[p]}`).join(" / ") +
    (preset ? `   |   preset ${preset}` : "") +
    (triLibelle ? `   |   sorted by ${triLibelle}` : "") +
    `   |   ${aujourdhui}`;

  const H = 6.6;   // hauteur d'une ligne

  const peindre = (doc) => {
    bandeau(doc, "QS Screener  ·  Dashboard", sous);
    enteteTable(doc, COLS);
    doc.police(8);

    titresTri.forEach((t, idx) => {
      const zebre = idx % 2 ? GRIS : BLANC;
      doc.x = doc.marge;

      for (const [, w, cle] of COLS) {
        //  Une case coloree est un pave : on la borde de blanc pour la
        //  detacher de sa voisine. Une case de texte reste dans le tableau,
        //  et garde le filet gris.
        doc.traitCouleur(PAVES.has(cle) ? BLANC : GRIS_BORD);
        if (PILIERS.includes(cle)) {
          const val = t.piliers[cle];
          const fond = couleurScore(val);
          doc.fondCouleur(rgb(fond)).texteCouleur(texteSur(fond)).police(8);
          doc.cell(w, H, f1(val), { align: "C", fill: true, border: true });

        } else if (cle === "total") {
          const fond = couleurScore(t.total);
          doc.fondCouleur(rgb(fond)).texteCouleur(texteSur(fond)).police(8, true);
          doc.cell(w, H, f1(t.total), { align: "C", fill: true, border: true });
          doc.police(8);

        } else if (cle === "conviction") {
          const fond = couleurScore(t.conviction);
          doc.fondCouleur(rgb(fond)).texteCouleur(texteSur(fond)).police(8);
          doc.cell(w, H, f1(t.conviction), { align: "C", fill: true, border: true });

        } else if (cle === "data") {
          const cov = (t.couverture ?? 1) * 100;
          const fond = couleurScore(cov);
          doc.fondCouleur(rgb(fond)).texteCouleur(texteSur(fond)).police(8);
          doc.cell(w, H, Math.round(cov).toString(), { align: "C", fill: true, border: true });

        } else if (cle === "valuation") {
          const fond = couleurScore(t.piliers.Value);
          doc.fondCouleur(rgb(fond)).texteCouleur(texteSur(fond));
          doc.police(7.5, !!t.sweet_spot);
          doc.cell(w, H, (t.sweet_spot ? "* " : "") + t.valuation, { align: "C", fill: true, border: true });
          doc.police(8);

        } else if (cle === "alertes") {
          const a = t.alertes;
          doc.traitCouleur(a ? BLANC : GRIS_BORD);
          doc.fondCouleur(a ? "rgb(255,199,206)" : zebre);
          doc.texteCouleur(a ? "rgb(192,0,0)" : NOIR).police(8, !!a);
          doc.cell(w, H, String(a), { align: "C", fill: true, border: true });
          doc.police(8);

        } else if (cle === "fcf") {
          const n = noteFcf(t.Ticker);
          if (n == null) {
            doc.traitCouleur(GRIS_BORD).fondCouleur(zebre).texteCouleur("rgb(170,175,185)").police(8);
            doc.cell(w, H, "–", { align: "C", fill: true, border: true });
          } else {
            const fond = couleurScore(n);
            doc.fondCouleur(rgb(fond)).texteCouleur(texteSur(fond)).police(8, true);
            doc.cell(w, H, String(Math.round(n)), { align: "C", fill: true, border: true });
            doc.police(8);
          }

        } else if (cle === "fcfmed") {
          const n = noteFcf(t.Ticker);
          coche(doc, w, H, n != null && medianeFcf != null && n >= medianeFcf, zebre);

        } else if (cle === "qv") {
          coche(doc, w, H, !!t.qv_median, zebre);

        } else {
          doc.traitCouleur(GRIS_BORD);
          doc.fondCouleur(zebre).texteCouleur(NOIR);
          const texte = {
            rank: String(t.rang),
            ticker: t.Ticker + (t.sweet_spot ? " *" : ""),
            sector: (t.Secteur || "").slice(0, 18),
            cap: t.Cap === null || t.Cap === undefined ? "" : Math.round(t.Cap).toString(),
            note: t.note,
            sect: `${t.rang_secteur}/${t.taille_secteur}`,
          }[cle];
          const align = cle === "ticker" || cle === "sector" ? "L" : "C";
          doc.police(8, cle === "ticker");
          doc.cell(w, H, texte, { align, fill: true, border: true });
          doc.police(8);
        }
      }
      doc.ln(H);
    });

    //  Legende : une entree par colonne plutot qu'un seul pave de texte.
    //  Le contenu ne change pas, mais on peut enfin y chercher une colonne
    //  precise sans relire le paragraphe entier.
    const pool = cfg.PERCENTILE_SECTORIEL ? "sector (else universe)" : "the whole universe";
    const base = cfg.MELANGE_ABSOLU > 0
      ? `blends ${Math.round(cfg.MELANGE_RELATIF * 100)}% relative rank (within ${pool}) ` +
        `+ ${Math.round(cfg.MELANGE_ABSOLU * 100)}% absolute anchors`
      : `is a relative percentile rank within ${pool}`;
    const entrees = [
      ["Scores", `Every score (0-100) ${base} — see the Methodology page. Colors run red → yellow → green.`],
      ["Grade", "The letter for TOTAL. NR = not rated: too little data behind the score."],
      ["R.Adj", "Risk-adjusted score: TOTAL minus a penalty per risk alert."],
      ["Data", "Share of the score backed by real data, in percent."],
      ["Valuation", "The Value pillar read as Attractive / Fair / Expensive."],
      ["*", `Project target: attractive valuation, solid quality (Quality ≥ ${cfg.SWEET_SPOT_QUALITE}) and a sound balance sheet (Health ≥ ${cfg.SWEET_SPOT_SANTE}).`],
      ["Q+V", "Green check: Quality and Value are both at or above the universe median."],
      ["FCF", "Free cash flow consistency, averaging the 5-year and 10-year scores (each blends growth 40%, how regular that growth was — R² of a log-linear fit — 40%, and how stable the FCF yield stayed 20%). Computed on the FCF page; “–” means the company has not been analysed there yet, or a negative FCF year makes the fit impossible."],
      ["vs Med", "Green check: at or above the median of the companies shown here that have an FCF score; companies without one do not count towards it. The 5-year and 10-year figures are in the CSV export."],
    ];
    doc.ln(5);
    doc.ligne(doc.marge, doc.y, doc.marge + doc.epw, doc.y, { couleur: GRIS_BORD });
    doc.ln(4);
    const largeurTerme = 20;
    for (const [terme, texte] of entrees) {
      const haut = doc.y;
      doc.police(7.2, true).texteCouleur(NOIR);
      doc.x = doc.marge;
      doc.cell(largeurTerme, 3.9, terme, { padding: 0 });
      doc.x = doc.marge + largeurTerme;
      doc.police(7.2).texteCouleur(GRIS_TEXTE);
      //  multiCell revient toujours a la marge : on decale le bloc en
      //  reduisant sa largeur et en le repositionnant ligne a ligne.
      for (const ligne of doc.decouper(texte, doc.epw - largeurTerme, 0)) {
        doc.texteDans(doc.marge + largeurTerme, doc.y, doc.epw - largeurTerme, 3.9, ligne, "L", 0);
        doc.y += 3.9;
      }
      doc.x = doc.marge;
      if (doc.y === haut) doc.y += 3.9;
      doc.y += 1.2;
    }
    doc.texteCouleur(NOIR);
  };

  return rendre(peindre, { largeurMm: LARGEUR_TABLE + 20, marge: 10, echelle });
}

// ---------------------------------------------------------------------
// Page 2 : METHODOLOGY
// ---------------------------------------------------------------------
export function dessinerMethodology(poids, { echelle = 8 } = {}) {
  const rel = Math.round(cfg.MELANGE_RELATIF * 100);
  const absp = Math.round(cfg.MELANGE_ABSOLU * 100);
  const montreAncres = cfg.MELANGE_ABSOLU > 0;
  const pool = cfg.PERCENTILE_SECTORIEL
    ? "the SECTOR (if enough peers) else the whole universe"
    : "the WHOLE UNIVERSE (one single pool)";

  const metrParPilier = {};
  for (const m of cfg.METRIQUES) (metrParPilier[m.pilier] ||= []).push(m);

  const peindre = (doc) => {
    const sousTitre =
      (montreAncres ? "Relative + absolute scoring" : "Relative scoring") +
      ", auto-calibrated to the universe you provide.";
    bandeau(doc, "Methodology  -  how each score is built", sousTitre);

    doc.police(8).texteCouleur(NOIR);
    const intro = montreAncres
      ? `Each metric score (0-100) = ${rel}% RELATIVE + ${absp}% ABSOLUTE.  ` +
        `RELATIVE = percentile rank within ${pool} ` +
        "(100 = best, 50 = median, 0 = worst).  ABSOLUTE = raw value mapped onto fixed " +
        "'quality-investing' anchors (last column: value scoring 0 -> value scoring 100), " +
        "so a mediocre company can't score high just because its peers are worse; negative " +
        "valuation multiples count as worst, not cheap.\n"
      : `Each metric score (0-100) is a pure PERCENTILE RANK within ${pool} ` +
        "(100 = best of the group, 50 = median, 0 = worst). No absolute anchors are " +
        "applied: a score means 'position within this basket', not an absolute verdict. " +
        "Add or remove a stock and everything recomputes.\n";

    doc.multiCell(doc.epw, 4.0,
      intro + "PILLAR = weighted average of its metric scores (weights below).  TOTAL = weighted " +
      "average of pillars: " + PILIERS.map((p) => `${p} ${poids[p]}%`).join(" / ") +
      ".  Missing metrics are dropped and the remaining weights renormalized (not set to 50); " +
      `below ${Math.round(cfg.SEUIL_COUVERTURE * 100)}% data coverage no grade is ` +
      "given (NR). Negative valuation multiples count as worst, never cheap.");
    doc.ln(1);

    const largeurAncre = montreAncres ? 26 : 0;
    const LARG_DESC = doc.epw - 44 - 11 - 14 - largeurAncre;
    const colsM = [["Metric", 44], ["Wt", 11], ["% TOTAL", 14]];
    if (montreAncres) colsM.push(["Anchor 0->100", 26]);
    colsM.push(["What it measures", LARG_DESC]);
    enteteTable(doc, colsM, 5.5);

    const HR = 4.4;
    for (const pilier of PILIERS) {
      const metrs = metrParPilier[pilier] || [];
      const sp = metrs.reduce((a, m) => a + m.poids, 0) || 1;

      doc.x = doc.marge;
      doc.fondCouleur(BLEU).texteCouleur(BLANC).police(8, true).traitCouleur(GRIS_BORD);
      doc.cell(doc.epw, HR, `  ${NOMS_PILIERS_LONG[pilier]}  -  ${poids[pilier]}% of TOTAL`,
        { align: "L", fill: true, border: true, padding: 0 });
      doc.ln(HR);
      doc.texteCouleur(NOIR);

      metrs.forEach((m, j) => {
        const zebre = j % 2 ? GRIS : BLANC;
        doc.x = doc.marge;
        doc.fondCouleur(zebre);

        doc.police(7.5, true);
        doc.cell(44, HR, cfg.NOMS_METRIQUES[m.cle] || m.cle, { align: "L", fill: true, border: true });
        doc.police(7.5);
        doc.cell(11, HR, `${Math.round((m.poids / sp) * 100)}%`, { align: "C", fill: true, border: true });
        doc.cell(14, HR, `${((m.poids / sp) * poids[pilier]).toFixed(1)}%`, { align: "C", fill: true, border: true });
        if (montreAncres) {
          const a = cfg.ANCRES_ABSOLUES[m.cle];
          doc.cell(26, HR, a ? `${a[0]} -> ${a[1]}` : "-", { align: "C", fill: true, border: true });
        }
        doc.cell(LARG_DESC, HR, cfg.DESCRIPTIONS_METRIQUES[m.cle] || "", { align: "L", fill: true, border: true });
        doc.ln(HR);
      });
    }

    // bloc "Added layers"
    doc.ln(1.5);
    doc.police(8.5, true).texteCouleur(BLEU);
    doc.cell(doc.epw, 4.5, "Added layers", { padding: 0 });
    doc.ln(4.5);
    doc.texteCouleur(NOIR).police(7.4);

    const grades = cfg.GRILLE_NOTES.map(([g, s]) => `${g} >= ${s}`).join(", ");
    const valos = cfg.NIVEAUX_VALUATION.map(([l, s]) => `${l} >= ${s}`).join(", ");
    const alertes = cfg.REGLES_ALERTES.map(([lib]) => lib).join("; ");
    const lignes = [
      `Grade (letter on TOTAL): ${grades}.`,
      `Risk-adjusted score (R.Adj) = TOTAL - ${cfg.MALUS_ALERTE} x (number of risk alerts), ` +
      `floored at 0.  Valuation (from Value pillar): ${valos}.`,
      `'*' sweet spot = Valuation 'Attractive' AND Quality >= ${cfg.SWEET_SPOT_QUALITE} ` +
      `AND Health >= ${cfg.SWEET_SPOT_SANTE}.  Risk alerts counted: ${alertes}.`,
    ];
    for (const l of lignes) doc.multiCell(doc.epw, 3.9, l, { padding: 0 });
  };

  return rendre(peindre, { largeurMm: 297, marge: 10, echelle });
}

// ---------------------------------------------------------------------
// Export CSV des resultats (equivalent de resultats.csv)
// ---------------------------------------------------------------------
export function csvResultats(retenus) {
  const notesFcf = lireEtat("fcf.notes", {});

  const entetes = ["Rank", "Ticker", "Sector", "Cap", ...PILIERS, "TOTAL", "Grade",
    "FCF5Y", "FCF10Y", "FCFAvg",
    "Valuation", "SweetSpot", "RiskAdjusted", "DataCoverage", "SectorRank",
    "Alerts", "AlertDetail", "Strengths", "Weaknesses"];
  const esc = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const ff = (paires) => paires.map(([nom, p]) => `${nom} (${Math.round(p)})`).join(", ");
  const lignes = [entetes.join(",")];
  for (const t of [...retenus].sort((a, b) => a.rang - b.rang)) {
    lignes.push([
      t.rang, t.Ticker, t.Secteur, t.Cap === null ? "" : t.Cap.toFixed(1),
      ...PILIERS.map((p) => f1(t.piliers[p])),
      f1(t.total), t.note,
      (notesFcf[t.Ticker] || {}).n5 ?? "", (notesFcf[t.Ticker] || {}).n10 ?? "",
      (() => {
        const n = notesFcf[t.Ticker] || {};
        const v = [n.n5, n.n10].filter((x) => x != null && isFinite(x));
        return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : "";
      })(),
      t.valuation, t.sweet_spot ? "*" : "",
      f1(t.conviction), Math.round((t.couverture ?? 0) * 100),
      `${t.rang_secteur}/${t.taille_secteur}`,
      t.alertes, t.alertes_detail.join("; "),
      ff(t.forces), ff(t.faiblesses),
    ].map(esc).join(","));
  }
  return lignes.join("\n");
}
