# FinScope — Audit des données financières

*Branche `data-quality-audit` · octobre 2026 · rien de ce qui est décrit ici n'est déployé en production sans validation.*

Ce document décrit le pipeline de données financières tel qu'il existe dans le code, ce qui a été mesuré sur des entreprises réelles, les problèmes trouvés, et ce qui a été corrigé. Le plan priorisé est dans [`FINANCIAL_DATA_IMPROVEMENT_PLAN.md`](FINANCIAL_DATA_IMPROVEMENT_PLAN.md).

---

## 1. Architecture actuelle

**Stack.** Next.js (App Router, via vinext) servi par un Cloudflare Worker ; stockage clé-valeur Cloudflare KV (`DATASET_CACHE`) ; tâches planifiées du Worker (`worker/index.ts`, cron toutes les 30 minutes + 4 fois par jour). Pas de base relationnelle en production (Drizzle est présent mais non utilisé par le pipeline financier).

**Pipeline des fondamentaux** (le cœur) :

```
SEC Company Facts (XBRL normalisé)  ─┐
SEC Submissions (métadonnées, SIC)   ├─► lib/adapters/sec.ts  extractFacts()     → RawFinancialFact[]   (brut, avec concept, filing, dates)
XBRL du dépôt lui-même (si en avance)┘                         lib/periods.ts       → périodes FY / FQ / TTM normalisées
                                                               normalizeSecPayload() → dérivations (Q4, banques, passifs…), splits, contrôles
                                                               validateCompanyDataset (lib/data-quality.ts)
                                                     KV  company:{v}:{ticker}   (CompanyDataset complet, ~4 Mo, 7 jours)
                                                               lib/io/view.ts companyView()  → IoCompanyView (ce que la page dessine)
                                                     KV  view:{shape}.{v}:{ticker}
                                                               lib/finance.ts derivedValue() → toutes les métriques dérivées
                                                               components/io/*, components/term/* → affichage
```

Chaque fait conserve sa **provenance** (`Provenance` dans `lib/types.ts`) : fournisseur, URL du dépôt, numéro d'accession, date de dépôt, **première date de publication** (`firstFiled`, anti look-ahead), concept XBRL, statut (`reported` / `restated` / `calculated`), formule et note. Les données brutes ne sont jamais écrasées : la normalisation produit de nouveaux objets, et les valeurs successives d'un même contexte sont conservées (`versions`).

**Pipeline des prix** : Yahoo Finance (chart v8, spark v7, search v1) via `lib/adapters/{candles,quotes,spark,intraday,yahoo}.ts`, mis en cache par `lib/market-cache.ts` (5 min pour le jour en cours, 24 h pour l'historique réglé, 60 s pour une réponse partielle, jamais pour une réponse vide).

**Versionnement.** `KEY_VERSION` (`lib/data-version.ts`, aujourd'hui `v38`) versionne le *sens* des données stockées ; `VIEW_SHAPE` (`lib/io/view-version.ts`, `iov11`) la *forme* de la vue. Chaque changement de sémantique est documenté dans le code. Pendant une reconstruction, la version précédente est servie (`SERVEABLE_WHILE_BUILDING`) pour ne jamais afficher de page vide.

## 2. Inventaire des fournisseurs

| Fournisseur | Endpoints | Données | Fraîcheur / cache | Limites, coût | Droits |
|---|---|---|---|---|---|
| **SEC EDGAR — Company Facts** | `data.sec.gov/api/xbrl/companyfacts/CIK…json` | Tous les faits XBRL US GAAP / IFRS / dei de 10-K, 10-Q, 20-F, 40-F | Dataset reconstruit à chaque nouveau dépôt détecté (veille toutes les 30 min sur le flux EDGAR), sinon 7 jours | Gratuit ; 10 req/s, User-Agent obligatoire ; `secFetch` réessaie sur 403/429/5xx | Domaine public |
| SEC — Submissions | `data.sec.gov/submissions/CIK…json` | SIC, bourse, liste des dépôts | idem | idem | Public |
| SEC — Archives | `sec.gov/Archives/edgar/data/…` | Index des dépôts, XBRL instance, linkbase de calcul | Lu seulement quand Company Facts est en retard sur le dernier dépôt, ou pour un capex propre à l'émetteur | idem | Public |
| SEC — Frames | `data.sec.gov/api/xbrl/frames/…` | Valeur d'un concept pour tous les émetteurs | Audit quotidien uniquement | idem | Public |
| SEC — 13F, Form 4 | Archives | Détenteurs institutionnels, initiés | 12 h | idem | Public |
| **Yahoo Finance** (non officiel) | `query1/2.finance.yahoo.com` v8 chart, v7 spark, v1 search | Prix, OHLCV, cours ajustés, devises, recherche | 5 min / 24 h | Gratuit, **sans contrat ni SLA**, peut bloquer | **Non redistribuable commercialement** — risque juridique documenté |
| **Nasdaq** | `api.nasdaq.com/api/calendar/earnings` | Calendrier des résultats, consensus BPA | 12 h | Gratuit, non officiel | Usage personnel ; consensus étiqueté « estimation analystes » |
| **OpenFIGI** | `api.openfigi.com/v3/mapping` | ISIN → ticker/bourse | 30 jours | Gratuit sans clé (25 req/min, 10 tâches/req) | Licence ouverte (Bloomberg) |
| Trésor US, NY Fed, BLS, OCDE, Banque mondiale | divers | Macro (taux, inflation…) | quotidien | Gratuit | Public |
| Flux RSS d'entreprises | ~10 sites IR | Actualités | horaire | Gratuit | Titres + liens seulement |

**Conflits entre sources.** Il n'y a qu'**une source par nature de donnée** (SEC pour les fondamentaux, Yahoo pour les prix), donc pas d'arbitrage multi-fournisseurs. Le seul recoupement est l'audit quotidien qui compare les chiffres annuels de chaque société aux *frames* de la SEC (`compareWithFrames`, `lib/coverage-audit.ts`).

**Faut-il ajouter un fournisseur payant ?** Non pour les fondamentaux US : la SEC est la source primaire, gratuite et exhaustive pour tout émetteur américain ; un agrégateur (FMP, Finnhub, Fiscal.ai) lit les mêmes dépôts et ajoute son propre mapping. Leur valeur ajoutée réelle se limite à : (1) les sociétés **non enregistrées à la SEC** (Schneider Electric, LVMH…), (2) les **segments** et KPI non-GAAP, (3) les **estimations** (forward P/E). Pour les **prix**, en revanche, la dépendance à Yahoo est le risque n°1 (contractuel et disponibilité) : une source licenciée (Polygon/Massive, Tiingo, EODHD) serait la première dépense justifiée si le site devient commercial. Décision commerciale — non engagée.

## 3. Méthode de validation

1. **Rapprochement avec les rapports officiels** — `tests/reconcile-filings.live.test.ts` (`npm run reconcile`) reconstruit chaque société avec le moteur du site et compare l'exercice le plus récent aux faits bruts de **son propre 10-K / 20-F / 40-F**, sous le concept même que le moteur a lu. Puis il exige qu'aucune identité comptable ne soit violée sur 5 ans.
2. **Identités comptables** sur 102 sociétés du S&P 500 (`identityFailures`, `lib/coverage-audit.ts`).
3. **Détecteurs de plausibilité** sur les 503 membres (`lib/io/plausibility.ts`), avant / après corrections.

### Jeu de validation — résultat final

| Société | Cas testé | Rapprochement 10-K | Identités (5 ans) | Remarques |
|---|---|---|---|---|
| MSFT | Exercice clos en juin, cloud | 0,00 % sur 10 postes | 0 échec | Dette nette corrigée : 19,4 Md$ de dette → **36,5 Md$ de trésorerie nette** |
| MA | Marges élevées, capitaux propres faibles | 0,00 % | 0 | ROE 193 % réel (capitaux propres 14 % de l'actif) |
| BKNG | Capitaux propres négatifs, split 25:1 | 0,00 % | 0 | ROE / ROIC non publiés (base négative) ; actions ajustées du split |
| SPGI | Acquisitions, *mezzanine equity* | 0,00 % | 0 | 3,4 Md$ d'intérêts minoritaires rachetables désormais lus et ajoutés à l'EV |
| CPRT | Exercice clos en juillet | 0,00 % | 0 | — |
| MCD | Capitaux propres négatifs | 0,00 % | 0 | **Passif total manquant → dérivé** (61,3 Md$), A = L + E au centime |
| JPM | Banque | 0,00 % | 0 | **BPA 20,51 → 20,02 $** (= publié) ; FCF / dette nette retenus par conception |
| BRK.B | Conglomérat, classes A/B | 0,00 % | 0 | **Aucun nombre d'actions ni BPA dans Company Facts** → pas de capitalisation (voir P1-6) |
| ASML | 20-F, EUR, annuel seulement | 0,00 % | 0 | Pas de trimestres : un émetteur étranger n'en dépose pas |
| SU | IFRS, 40-F, CAD | 0,00 % sur les postes présents | 0 | **SU = Suncor à la SEC**, pas Schneider Electric ; flux de trésorerie IFRS absents de Company Facts |

Schneider Electric ne dépose rien à la SEC : il est hors du périmètre de la source primaire.

## 4. Problèmes identifiés

Gravité : **P0** donnée fausse affichée · **P1** standardisation · **P2** fiabilité · **P3** amélioration. ✅ corrigé sur la branche · ⏳ ouvert.

### P0 — données incorrectes

| # | Problème | Exemple mesuré | Fichiers | Statut |
|---|---|---|---|---|
| P0-1 | Divisions d'actions détectées en double ou à l'envers (ordre « ratio déclaré » avant « restatement ») | ANET : 8 splits détectés dont 2 inverses pour 2 réels ; 34 sociétés avec un nombre d'actions trimestriel aberrant | `lib/adapters/sec.ts` (`normalizeSecPayload`, `restatedStockSplits`) | ✅ (commit `8c1c2a9`) |
| P0-2 | Q4 calculé (année − 9 mois) à travers un retraitement | KMB Q4 2023 : 1,7 Md$ au lieu de 4,97 ; GOOGL Q4 2021 : 3,8 Md d'actions | `lib/periods.ts` | ✅ (année « telle que publiée à l'origine », sinon retrait) |
| P0-3 | Ratios sur une base quasi nulle | SPGI ROE 2 445 %, ROIC 2 543 % | `lib/finance.ts` (`returnOn`, `margin`) | ✅ |
| P0-4 | Solde de bilan pris sous le concept déposé le plus récemment plutôt que le concept préféré | Agilent capitaux propres −0,33 Md$ au lieu de 5,85 ; ROIC 180 % | `lib/periods.ts` (`preferredInstant`) | ✅ (`be2acec`) |
| P0-5 | Chiffre d'affaires d'un émetteur de cartes = une composante | AXP 2025 : 41,3 au lieu de 72,2 Md$ | `lib/periods.ts` (`preferTotalRevenue`) | ✅ |
| P0-6 | Chiffre d'affaires d'une banque = ses seules commissions | Regions 2021 : 104 M$ au lieu de 6,4 Md$ | `lib/adapters/sec.ts` (`deriveBankRevenue`) | ✅ |
| P0-7 | **BPA et P/E sur le résultat total, dividendes préférentiels inclus** | JPM : 20,51 $ contre 20,02 publié (+2,45 %) ; toutes les banques à actions préférentielles | `lib/finance.ts`, `components/io/Stats.tsx`, `lib/company-statistics.ts`, `lib/valuation-history.ts` | ✅ |
| P0-8 | **Dette nette = dette − cash seulement** (placements court terme ignorés) | MSFT : 19,4 Md$ de dette nette affichée pour 36,5 Md$ de trésorerie nette ; EV surévaluée de 56 Md$ | `lib/finance.ts`, `lib/io/view.ts`, `lib/qs-export.ts`, `lib/io/full-dcf.ts` | ✅ |
| P0-9 | Repli silencieux : `derivedValue` retombait sur le fait brut quand sa propre règle l'avait rejeté | Ligne mal datée de Southwest réintroduite par ce biais | `lib/finance.ts` | ✅ |
| P0-10 | Société à deux classes sans nombre d'actions | BRK.B : pas de capitalisation, P/E, BPA | Company Facts n'expose pas les comptes par classe | ⏳ P1-6 |

### P1 — standardisation

| # | Problème | Exemple | Statut |
|---|---|---|---|
| P1-1 | **Incohérence entre pages** : la « santé financière » nettait cash + placements, les statistiques / EV / DCF / screener le cash seul | 4 définitions de la dette nette dans le code | ✅ une seule (`liquidAssets`, `netDebt`) |
| P1-2 | **EV sans intérêts minoritaires ni *mezzanine equity*** | SPGI : 3,4 Md$ de créances prioritaires absentes | ✅ ajoutés (`minorityInterest` + `temporaryEquity`) |
| P1-3 | Passif total absent quand l'émetteur ne le tague pas | MCD, Suncor | ✅ dérivé avec formule et note |
| P1-4 | Banques sans chiffre d'affaires (concept non tagué depuis 2023) | TFC, RF, FITB, SYF, BNY | ✅ (NII + revenus hors intérêts) |
| P1-5 | Deux définitions du ROIC | Page : NOPAT / capital investi de fin de période ; screener QS : capital **moyen** | ⏳ documenté (§6) ; unifier = changer le modèle de notation |
| P1-6 | Classes d'actions (BRK) | voir P0-10 | ⏳ lire `dei:EntityCommonStockSharesOutstanding` par classe dans l'XBRL du dépôt |
| P1-7 | Ambiguïté de ticker entre marchés | SU = Suncor (NYSE) ≠ Schneider (Euronext) | ✅ par construction (CIK) ; ⏳ afficher la bourse dans la recherche |
| P1-8 | Ratios manquants au registre central | ratio de liquidité générale, dette nette / EBITDA | ✅ ajoutés (`currentRatio`, `netDebtToEbitda`) |
| P1-9 | ISIN non résolus à l'import de portefeuille | Degiro, Trade Republic | ✅ (`lib/adapters/isin.ts`, OpenFIGI) |

### P2 — fiabilité

| # | Problème | Exemple | Statut |
|---|---|---|---|
| P2-1 | Contrôles comptables non branchés : `runDatasetInvariants` n'était utilisé que par l'historique de valorisation | — | ✅ branché sur l'audit quotidien et `/status` ; identité A = L + temp. equity + E + minoritaires ajoutée |
| P2-2 | Aucun rapprochement automatisé avec les 10-K | — | ✅ `npm run reconcile` |
| P2-3 | Traçabilité invisible pour l'utilisateur | La provenance existait mais la vue la retirait | ✅ `IoPeriod.basis` + infobulle et soulignement sur chaque chiffre calculé ou retraité |
| P2-4 | Année retraitée vs trimestres d'origine (changement de périmètre) | 3M (Solventum), J&J (Kenvue), HON, FTV | ✅ classé « changement de périmètre » (avertissement) et non erreur ; ⏳ série trimestrielle retraitée non disponible à la source |
| P2-5 | Marge brute ≠ CA − coût des ventes pour 8 sociétés | Centene : coût des ventes partiel | ⏳ signalé par l'audit quotidien |
| P2-6 | Actif ≠ passif + capitaux propres (4 sociétés, retraitements) | Marsh 2021, Citi T1-T2 2021 | ⏳ signalé |
| P2-7 | Flux IFRS absents de Company Facts pour certains 40-F | Suncor : pas de flux de trésorerie | ⏳ lire l'XBRL du dépôt |
| P2-8 | Dépendance aux prix Yahoo (non contractuelle) | — | ⏳ décision commerciale |

### P3 — améliorations

Segments (ex. CA Google Cloud), estimations prospectives (forward P/E — aujourd'hui volontairement absentes), données mondiales hors SEC, rendement de rachat (*buyback yield*) et taux de réinvestissement dans le registre central.

## 5. Normalisation temporelle (vérifiée dans le code)

* **FY / FQ** : année fiscale de l'émetteur, rattachée à la fenêtre annuelle réelle qui contient le fait (années de 52/53 semaines gérées, `fiscalYearOfEnd`, v21/v34).
* **Trimestres autonomes** : un trimestre déposé directement est préféré ; sinon `cumul(T) − cumul(T−1)` ; Q4 = année − 9 mois, sur la même base que les trimestres (**jamais une somme de valeurs YTD**). Un trimestre implausible (hors 2,2× de ses voisins concordants et de l'an passé) est retiré, jamais publié.
* **TTM** : somme de quatre trimestres consécutifs (durées et écarts vérifiés, 330–380 jours) ; pour les flux sans Q4 calculable, *pont* exact `FY précédent + YTD courant − YTD précédent`. **Bilan** : observation à la date du dernier trimestre, jamais une somme. **Actions** : moyenne pondérée par les jours.
* **Ratios** : calculés à partir des valeurs de la même période (marges sur la même période, rendements sur le solde de fin de période — choix documenté), BPA = résultat aux actionnaires ordinaires / actions diluées moyennes.
* **Look-ahead** : chaque période porte `publishedAt` (première publication du chiffre) ; l'historique de valorisation l'utilise, de sorte qu'un multiple historique n'est jamais calculé avec un chiffre pas encore publié.
* **Corrections rétroactives** : le chiffre le plus récent est retenu, la date de première publication est conservée, et les versions antérieures restent dans `versions`.
* **Retraitement de périmètre (scission, cession)** : l'exercice affiché est le dernier publié (périmètre retraité) ; les trimestres sont ceux publiés à l'époque, et le Q4 est désormais calculé sur leur base. Conséquence assumée et mesurée : le TTM au dernier trimestre d'un exercice retraité diffère de la colonne annuelle (150 sociétés sur 327 ont au moins une année concernée, surtout avant 2021 — 3M/Solventum, IBM/Kyndryl, J&J/Kenvue, Dollar Tree/Family Dollar). Avant, ce Q4 était faux ou absent. La SEC ne publie pas les trimestres retraités de façon systématique ; quand un 10-K les donne en comparatif, ils sont repris (v15).

## 6. Conventions des ratios (définitions centrales — `lib/finance.ts`, `lib/metrics.ts`)

| Ratio | Définition retenue | Non publié quand |
|---|---|---|
| Marge brute / opé. / nette / FCF | poste ÷ CA de la même période | \|marge\| > 500 % (CA résiduel) |
| ROE | Résultat net ÷ capitaux propres de fin de période | capitaux propres ≤ 0 ou < 5 % de l'actif |
| ROA | Résultat net ÷ actif total | \|ROA\| > 100 % (actif mal échelonné) |
| ROIC | NOPAT (taux effectif, 21 % si inutilisable) ÷ (dette + capitaux propres − cash), fin de période | capital ≤ 0 ou < 5 % de l'actif ; banques, assureurs |
| ROIC (screener QS) | NOPAT ÷ capital investi **moyen** début/fin d'année | — (définition propre au modèle de notation, à unifier : P1-5) |
| Dette nette | Dette totale − (cash + placements court terme) | dette ou cash non déposés ; banques, assureurs |
| EV | Capitalisation + dette nette + intérêts minoritaires + *mezzanine equity* | prix et comptes en devises différentes (sans taux) |
| P/E | Capitalisation ÷ résultat aux actionnaires ordinaires | résultat ≤ 0 |
| BPA | Résultat aux actionnaires ordinaires (arbitré par le BPA publié) ÷ actions diluées | — |
| P/FCF, rendement FCF | Capitalisation ÷ FCF, et inverse | FCF ≤ 0 ; banques |
| EV/EBITDA | EV ÷ (résultat opérationnel + D&A) | EBITDA ≤ 0 |
| Dette nette / EBITDA | idem | EBITDA ≤ 0 |
| Couverture des intérêts | Résultat opérationnel ÷ charges d'intérêts | pas de charge d'intérêts |
| Croissance / TCAC | (fin ÷ début)^(1/années) − 1, années datées | extrémité ≤ 0 |
| SBC / CA, SBC / FCF | rémunération en actions ÷ poste | dénominateur nul |
| Dividende / résultat | dividendes ÷ résultat net | résultat ≤ 0 |

Banques et courtiers : FCF, dette nette, ROIC non publiés (le flux d'exploitation est le mouvement de leurs prêts) ; lecture « prêteur » à la place (ROE, capital tangible, rendement des actifs — `lib/io/lender.ts`). Assureurs : FCF conservé, dette nette et ROIC non publiés.

## 7. Identification

* **Identifiant pivot : le CIK SEC**, pas le ticker. Ticker → CIK par le registre interne (`lib/universe.ts`, 503 membres) puis par le registre SEC (`company_tickers.json`).
* Classes d'actions : `BF.B` / `BF-B` unifiés (`sameListing`). ADR : actions par certificat (`lib/adr.ts`). Successeurs : `KNOWN_SUCCESSORS` (Exxon). ISIN → ticker : OpenFIGI, bourses US seulement.
* Ticker renommé après fusion : si le fichier de tickers de la SEC ne connaît pas encore le symbole, le CIK de la liste du S&P 500 est utilisé (✅ PSKY — Paramount Skydance — ne se construisait pas du tout).
* Non géré : rattachement de l'historique d'un **prédécesseur** sous un autre CIK (PSKY n'a que 2 exercices sous son nouveau CIK ; Paramount Global est sous l'ancien), sociétés radiées (*delisted*) — le moteur lit l'émetteur actuel d'un CIK.

## 8. Contrôles automatiques en place

| Contrôle | Où | Résultat |
|---|---|---|
| Rapprochement 10-K (10 sociétés) | `npm run reconcile` | **10 / 10 au centime** |
| Identités comptables (A = L + E, CA − coût = marge brute, FCF = OCF − capex, Σ trimestres = année, TTM = Σ 4 trimestres, BPA = BPA publié) | audit quotidien + `/status` | 102 sociétés : 37 en échec avant → **30 après** ; restants listés en §4 |
| Plausibilité (sauts trimestriels, ratios sur base nulle, marges impossibles, CA manquant, actions incohérentes) | audit quotidien + `/status` | Sur les 327 sociétés signalées par le premier audit, reconstruites avant / après : sauts d'actions trimestriels 37 → 0 sociétés, sauts de CA 25 → 1, coût des ventes 16 → 2, ROA impossibles 9 → 0, ROE sur base nulle 87 → 53, ROIC 35 → 21, marges brutes impossibles 8 → 1, CA récent manquant 19 → 7, actions incohérentes 9 → 1 |
| Écart avec les frames SEC | audit quotidien | inchangé |
| Retrait plutôt que zéro | partout | un chiffre absent est affiché « — » avec sa raison, jamais 0 |

## 9. Performance

Les datasets sont **pré-calculés** (cron + à la demande) et stockés en KV ; une page lit une vue projetée et mise en cache. Une société inconnue coûte ~90 s de normalisation au premier accès (désormais attendue jusqu'à 3 min côté client). Les prix sont mis en cache par la périphérie (5 min) et en KV. Pas d'appels redondants identifiés hors du préchargement des pages société (un appel par panneau, mutualisés par l'edge cache).

## 10. Évaluation de la fiabilité

Sur le périmètre SEC, les **chiffres déposés** sont fidèles au centime (10 / 10). Les erreurs restantes viennent de deux sources : (1) les **chiffres calculés** (trimestres dérivés, ratios), désormais encadrés par des contrôles et marqués à l'écran ; (2) les **trous de la source** (classes d'actions, flux IFRS de certains 40-F, segments), documentés et non comblés par des valeurs inventées.
