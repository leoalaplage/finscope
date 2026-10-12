# FinScope — Plan : segments, indicateurs propres aux sociétés et estimations

*12 octobre 2026. Faisabilité vérifiée sur les sources réelles avant d'écrire ce plan.*

Périmètre de départ : les 20 premières capitalisations du S&P 500 du site — NVDA, AAPL, MSFT, GOOGL, AMZN, META, AVGO, BRK.B, TSLA, JPM, LLY, V, NFLX, XOM, COST, MA, WMT, UNH, PG, JNJ — puis tout l'indice, la mécanique étant générique.

---

## 1. Ce que les sources permettent vraiment

| Besoin | Source gratuite | Vérifié | Verdict |
|---|---|---|---|
| **Segments** (CA, résultat opé., carnet par division) | XBRL complet de chaque 10-Q / 10-K sur EDGAR (dimensions `StatementBusinessSegmentsAxis`, `ProductOrServiceAxis`, géographie) | ✅ Alphabet T2 2026 : Google Cloud CA 24,77 Md$, résultat opé. 8,81 Md$, **carnet 513,9 Md$** ; Search 63,27 ; YouTube Ads 11,05 ; CA par région | **Faisable, gratuit, exact.** Company Facts (notre flux actuel) ne contient pas ces dimensions, mais le fichier XBRL du dépôt, si. |
| **Indicateurs opérationnels** (utilisateurs actifs, livraisons, volumes de paiement…) | Communiqués de résultats (8-K, pièce 99.1) — **pas dans l'XBRL** | ✅ vérifié : ni Meta ni Netflix ne les taguent | Faisable, mais par extraction de texte et de tableaux, avec contrôle. |
| **Consensus BPA** trimestriel ×5 et annuel, haut / bas, nombre d'analystes, révisions 4 semaines, consensus il y a 1 semaine / 1 mois | Nasdaq (données Zacks), `api.nasdaq.com/api/analyst/{t}/earnings-forecast` et `estimate-momentum` | ✅ MSFT : T3 2026 4,71 $ (13 analystes, 0 hausse / 1 baisse), exercice 2027 19,65 $ | **Faisable, gratuit.** |
| **Objectif de cours, recommandations** (haut / moyen / bas, achat / conserver / vendre, historique mensuel) | Nasdaq `targetprice`, `ratings` | ✅ MSFT : 587 $ (440–725), 34 achat / 1 conserver | **Faisable, gratuit.** |
| **Estimations de CA, d'EBITDA, de FCF** | Aucune source gratuite fiable (Yahoo `quoteSummary` répond « Too Many Requests » et demande un jeton de session) | ❌ | **Nécessite un fournisseur payant** (voir §4). |
| **Historique des révisions** | Personne ne le donne gratuitement au-delà d'un mois | — | **On le construit nous-mêmes** : une photo du consensus chaque jour. |

Deux mises en garde à garder en tête :
- **Netflix ne publie plus son nombre d'abonnés depuis 2025.** Aucun fournisseur ne l'a au-delà de 2024 ; seule la série historique existe.
- **Les données Nasdaq/Zacks** sont destinées à la consultation : une redistribution commerciale demanderait une licence. Même réserve que pour Yahoo, déjà notée dans l'audit.

---

## 2. Segments — plan de mise en œuvre

### Étape 1 : extraction générique (tous les émetteurs)

1. **Lecture** : pour chaque société, les fichiers XBRL des 8 derniers 10-Q / 10-K. Un 10-K contient 3 ans de comparatifs, donc environ 5 ans d'historique trimestriel avec seulement une vingtaine de fichiers. Le site lit déjà ces fichiers pour d'autres besoins (`lib/adapters/xbrl-instance.ts`, `parseXbrlInstance`) : on l'étend aux **contextes dimensionnels**.
2. **Axes retenus** :
   - segments opérationnels (`StatementBusinessSegmentsAxis`) ;
   - produits et services (`ProductOrServiceAxis`) ;
   - géographie (`StatementGeographicalAxis`) ;
   - grands clients (`MajorCustomersAxis`).
3. **Mesures retenues** :
   - chiffre d'affaires ;
   - résultat d'exploitation du segment ;
   - carnet de commandes (RPO) ;
   - actifs ;
   - amortissements ;
   - capex par segment (publiés depuis la norme ASU 2023-07).
4. **Noms lisibles** : le libellé de chaque membre est lu dans le fichier de libellés du dépôt (« Google Cloud » et non `GoogleCloudMember`).
5. **Trimestres** : même règle que le moteur actuel. Le trimestre publié directement est pris tel quel ; le T4 = exercice − 9 mois, sur la même base ; un trimestre implausible est retiré.
6. **Stockage** : clé KV `segments:v1:{ticker}`, reconstruite par la veille EDGAR existante quand un nouveau 10-Q / 10-K arrive.

### Étape 2 : contrôles automatiques

- **Somme des segments** + éléments non alloués = CA consolidé (identité ajoutée à l'audit quotidien et à `/status`).
- **Réorganisation des segments** (Microsoft en 2024, Amazon, Alphabet « Other Bets »…) : une série qui change de définition est coupée et signalée, jamais raccordée en silence.
- `npm run reconcile` étendu : les segments du dernier 10-K égalent ceux du dépôt.

### Étape 3 : sélection éditoriale pour les 20 plus grosses sociétés

Un fichier de configuration par société (`lib/segments/curated/*.ts`) dit :
- quels segments afficher et dans quel ordre ;
- comment raccorder les membres renommés ;
- quels ratios dériver (marge du segment, carnet ÷ CA du segment).

Exemples :

| Société | Segments / mesures |
|---|---|
| GOOGL | Services (Search, YouTube, Network, Subscriptions), **Cloud CA, marge et carnet** → le graphique « Cloud Backlog & Coverage » devient exact |
| MSFT | Productivity, Intelligent Cloud, Personal Computing (+ Azure si tagué) |
| AMZN | North America, International, **AWS** (CA, marge) |
| AAPL | iPhone, Mac, iPad, Wearables, Services ; régions |
| NVDA | Data Center, Gaming, Pro Viz, Automotive |
| META | Family of Apps, Reality Labs |
| TSLA | Automotive, Energy, Services |
| LLY | CA par produit (Mounjaro, Zepbound, Verzenio…) |
| V / MA | CA par nature de services |
| JPM | CCB, CIB, AWM (CA et résultat) |
| XOM | Upstream, Energy Products, Chemicals, Specialty |
| BRK.B | Assurance, BNSF, BHE, Manufacturing… |

### Étape 4 : affichage

- **Panneau `SEG`** sur la fiche société (terminal et page classique) :
  - CA et résultat par segment, en barres empilées, trimestriel / annuel / TTM ;
  - marge par segment ;
  - mix géographique ;
  - chaque chiffre avec son lien vers le dépôt.
- **Nouveaux graphiques prêts à l'emploi dans `GF`** :
  - CA par segment ;
  - marge par segment ;
  - carnet du segment et couverture (carnet ÷ CA du segment) ;
  - mix géographique.
- **Screener** : quelques colonnes de segments pour les sociétés concernées (« part du cloud », « croissance du segment principal »).

**Estimation** : étapes 1 et 2 en 2 à 3 sessions ; étape 3 pour 20 sociétés en 1 à 2 sessions ; étape 4 en 1 à 2 sessions.

---

## 3. Indicateurs opérationnels propres à chaque société — plan

Ils ne sont pas dans l'XBRL, ce qui demande une approche différente et plus prudente.

1. **Catalogue fermé par société** (pour les 20) : la liste exacte des indicateurs, leur définition et l'unité. Par exemple :

   | Société | Indicateurs |
   |---|---|
   | META | Utilisateurs actifs quotidiens (DAP), revenu moyen par personne (ARPP), nombre d'impressions publicitaires, prix moyen par publicité |
   | TSLA | Livraisons, production, capacité de stockage déployée |
   | V | Volume de paiements, transactions traitées |
   | MA | Volume brut (GDV), transactions |
   | NFLX | Abonnés jusqu'en 2024 (série figée, étiquetée comme telle) |
   | AMZN | Croissance d'AWS |
   | UNH | Membres assurés, ratio de sinistralité |
   | COST | Membres, taux de renouvellement, ventes comparables |
   | WMT | Ventes comparables, croissance e-commerce |
   | JPM | Dépôts moyens, prêts moyens, actifs sous gestion |

2. **Source** : le communiqué de résultats (8-K, pièce 99.1) et, le cas échéant, la lettre aux actionnaires, sur EDGAR, pour les 12 à 20 derniers trimestres.
3. **Extraction en deux couches** :
   - **règles par société** (repère de libellé dans le tableau) quand le format est stable ;
   - sinon, **extraction par l'API Claude** avec un schéma strict.

   **Règle non négociable** : la valeur retenue doit figurer telle quelle dans le document, à côté du libellé attendu. Sinon elle est rejetée et listée pour revue. Aucun chiffre déduit ou recalculé.
4. **Provenance** : chaque valeur garde son numéro de dépôt, l'URL de la pièce, la citation exacte et la date de publication, et l'interface affiche la citation au survol.
5. **Revue** : une file « à vérifier » sur `/status` pour les nouveautés de chaque trimestre.
6. **Coût** : quelques centimes par société et par trimestre en appels Claude ; ordre de grandeur de moins de 5 $ pour constituer l'historique des 20 sociétés.

**Estimation** : 3 à 4 sessions pour 20 sociétés et 4 ans d'historique.

---

## 4. Estimations des analystes — plan

### Phase 1 : gratuite (Nasdaq / Zacks), tout de suite

1. **Adaptateur** `lib/adapters/nasdaq-estimates.ts` qui lit `earnings-forecast`, `estimate-momentum`, `targetprice` et `ratings`, mis en cache 12 h comme le calendrier actuel.
2. **Photo quotidienne** du consensus (BPA trimestre +1…+5, exercices +1 et +2, nombre d'analystes, objectif de cours) dans KV par la tâche planifiée → **historique des révisions** qui s'enrichit chaque jour.
3. **Nouveaux calculs**, avec mention « estimations analystes » partout :
   - **P/E prospectif** : cours ÷ somme des BPA attendus sur les 4 prochains trimestres ;
   - **PEG** : P/E prospectif ÷ croissance attendue du BPA ;
   - **croissance attendue du BPA**, sur l'exercice et l'exercice suivant ;
   - **potentiel** : écart entre l'objectif de cours et le cours ;
   - **surprises historiques** : réel contre attendu (déjà en partie dans le calendrier).
4. **Affichage** :
   - panneau `EST` sur la fiche : tableau de consensus, révisions, courbe du consensus dans le temps, objectif de cours avec sa fourchette, répartition achat / conserver / vendre ;
   - graphique « BPA réel contre attendu » dans `GF` ;
   - colonnes P/E prospectif et révisions dans le screener.

**Estimation** : 1 à 2 sessions. C'est la partie la plus rapide et la plus visible.

### Phase 2 : estimations de CA, EBITDA et FCF (payante)

Aucune source gratuite fiable n'existe. Les options, à vérifier au moment de choisir :

| Fournisseur | Apport | Ordre de prix |
|---|---|---|
| Financial Modeling Prep | Estimations annuelles et trimestrielles de CA, EBITDA, BPA (moyenne, haut, bas), objectifs de cours | ~20–70 $/mois selon l'offre |
| Finnhub | Estimations de CA et de BPA, révisions | offre payante |
| Alpha Vantage | Point d'accès « earnings estimates » (BPA et CA, révisions), quota gratuit très limité | gratuit à tester / payant |

Recommandation :
- d'abord la **phase 1**, qui ne coûte rien et couvre BPA, objectifs de cours et révisions ;
- ensuite, si tu veux le CA prévisionnel, **un essai de FMP** sur les 20 sociétés avant de t'engager.

C'est une décision de dépense qui te revient.

---

## 5. Ordre proposé

| # | Chantier | Effort | Coût | Valeur |
|---|---|---|---|---|
| 1 | Estimations phase 1 (BPA, objectifs, révisions, P/E prospectif) | 1–2 sessions | 0 | Élevée, visible tout de suite |
| 2 | Segments XBRL génériques + contrôles | 2–3 sessions | 0 | Très élevée (le cœur de Fiscal.ai) |
| 3 | Sélection et graphiques segments pour les 20 | 2–3 sessions | 0 | Élevée |
| 4 | Indicateurs opérationnels des 20 (extraction contrôlée) | 3–4 sessions | < 5 $ d'API | Élevée, plus délicate |
| 5 | Estimations de CA / EBITDA | 1 session | abonnement | Selon ton choix |

Préalable : fusionner et déployer la branche `data-quality-audit` (en attente de ton accord), pour que ces chantiers partent d'une base corrigée.
