# FinScope — Plan d'amélioration des données financières

Constat détaillé : [`FINANCIAL_DATA_AUDIT.md`](FINANCIAL_DATA_AUDIT.md). Chaque ligne indique le problème, sa cause, la solution, l'impact, la complexité, le risque de régression et les tests. **Statut** : ✅ implémenté et testé sur la branche `data-quality-audit` (ou déjà en production quand un commit est cité), ⏳ à faire.

> **Mise en production.** Les corrections de cette branche changent le sens des données stockées (`KEY_VERSION` v37 → v38) et la forme de la vue (`iov10` → `iov11`). Un déploiement reconstruit tout le S&P 500 en ~2 h 30 par la tâche planifiée, en servant v37 entre-temps : aucune donnée n'est supprimée et aucune migration destructive n'est exécutée. **Rien n'est déployé sans validation.**

## P0 — données incorrectes

| # | Problème | Cause | Solution | Impact | Complexité | Risque | Tests | Statut |
|---|---|---|---|---|---|---|---|---|
| P0-1 | Splits fantômes | Ratios déclarés appliqués avant les retraitements | Retraitements d'abord, ratios déclarés pour le reste | 37 sociétés au nombre d'actions faux → 0 | M | Moyen (tout l'historique d'actions) | `data-plausibility.test.ts`, audit 327 sociétés | ✅ `8c1c2a9` (prod) |
| P0-2 | Q4 faux après retraitement | Année retraitée − 9 mois d'origine | Année « telle que publiée », sinon retrait du trimestre | KMB, CARR, JNJ… | M | Faible (filet de plausibilité) | idem | ✅ `3d33ec4` (prod) |
| P0-3 | ROE / ROIC sur base quasi nulle | Division sans garde | Base < 5 % de l'actif → non publié | SPGI, ADSK, BBY… | S | Faible | `data-plausibility.test.ts` | ✅ (prod) |
| P0-4 | Concept de bilan erroné | « Dernier déposé gagne » entre concepts | Ordre de préférence des concepts | Agilent ; capitaux propres hors minoritaires partout | S | Moyen (54 / 102 sociétés changent, toutes vers la définition voulue) | `data-plausibility.test.ts` | ✅ `be2acec` (prod) |
| P0-5 | CA d'AXP = composante | Concept « contrat » préféré au total | Total net de charges d'intérêts quand plus grand | AXP +75 % | S | Faible | `revenue-total.test.ts` | ✅ (prod) |
| P0-6 | CA de Regions = commissions | Ligne « contrat » d'une banque | NII + revenus hors intérêts quand la ligne est partielle | Banques | S | Faible | `financial-standards.test.ts` | ✅ branche |
| P0-7 | BPA / P/E incluant les dividendes préférentiels | Résultat total ÷ actions | `netIncomeToCommon`, arbitré par le BPA publié de l'émetteur | JPM 20,51 → 20,02 ; banques, GM, IBKR | M | Moyen (BPA de toutes les sociétés à préférentielles) | `financial-standards.test.ts`, identité « BPA = BPA publié » 41 → 22 périodes en échec | ✅ branche |
| P0-8 | Dette nette sans placements CT | Cash seul | `liquidAssets` = cash + placements CT, une seule définition | MSFT : −56 Md$ d'EV ; tout le CAC tech | S | Moyen (EV, EV/EBITDA, DCF, score QS) | `financial-standards.test.ts`, `statement-flows.test.ts` | ✅ branche |
| P0-9 | Repli silencieux sur une valeur rejetée | `map[key] ?? fait brut` | Une clé définie répond pour elle-même, null compris | Toute règle de rejet | S | Faible | `financial-standards.test.ts` | ✅ branche |
| P0-10 | BRK.B sans actions | Comptes par classe hors Company Facts | Lire la page de garde XBRL du dernier 10-K/10-Q (classes A et B, conversion 1 A = 1 500 B) | Capitalisation, P/E de la 7ᵉ capitalisation US | M | Faible (cas isolé) | test sur l'instance XBRL de BRK | ⏳ |

## P1 — standardisation

| # | Problème | Cause | Solution | Impact | Complexité | Risque | Tests | Statut |
|---|---|---|---|---|---|---|---|---|
| P1-1 | Dette nette définie 4 fois | Calculs dupliqués par page | `finance.liquidAssets` / `netDebt` utilisés partout | Cohérence santé / stats / EV / DCF / screener | S | Faible | `ui-regressions.test.ts` | ✅ |
| P1-2 | EV incomplète | Minoritaires et *mezzanine* non lus | Concepts `MinorityInterest`, `TemporaryEquity…` ; EV = cap + dette nette + créances prioritaires | SPGI +3,4 Md$ | S | Faible | `financial-standards.test.ts` | ✅ |
| P1-3 | Passif total absent | Non tagué | Dérivé du total passif + capitaux propres, formule et note | MCD, Suncor | S | Faible | `financial-standards.test.ts` | ✅ |
| P1-4 | Banques sans CA | Concept abandonné | NII + revenus hors intérêts | 7 banques | S | Faible | `financial-standards.test.ts` | ✅ (prod + branche) |
| P1-5 | Deux ROIC | Capital moyen (QS) vs fin de période (page) | Adopter le capital moyen partout **ou** renommer celui du screener ; décision produit (modifie les notes QS) | Cohérence | M | Moyen (notes QS) | `qs-*.test.ts` | ⏳ |
| P1-6 | Classes d'actions | voir P0-10 | idem | — | M | Faible | — | ⏳ |
| P1-7 | Ambiguïté de ticker | Un ticker = plusieurs marchés | Afficher bourse + pays dans la recherche ; alerter quand une recherche ressemble à une valeur hors SEC | UX | S | Faible | test de recherche | ⏳ |
| P1-8 | Ratios hors registre | Calculs locaux | `currentRatio`, `netDebtToEbitda` dans `derivedValue` + `METRICS` | Écrans futurs | S | Faible | `financial-standards.test.ts` | ✅ |
| P1-9 | ISIN | — | OpenFIGI, bourses US | Import Degiro / TR | M | Faible | `broker-csv.test.ts` | ✅ (prod) |

## P2 — fiabilité et performance

| # | Problème | Solution | Complexité | Statut |
|---|---|---|---|---|
| P2-1 | Identités comptables non surveillées | `identityFailures` par société dans l'audit, section dédiée sur `/status`, identité A = L + *mezzanine* + E + minoritaires | S | ✅ |
| P2-2 | Pas de rapprochement 10-K automatisé | `tests/reconcile-filings.live.test.ts` (`npm run reconcile`, `RECONCILE="AAPL KO"`) | S | ✅ |
| P2-3 | Provenance invisible | `IoPeriod.basis` : formule ou « retraité » sur chaque chiffre concerné ; soulignement pointillé + infobulle ; définition sur chaque libellé de ligne | S | ✅ |
| P2-4 | Année retraitée vs trimestres d'origine | Classée « changement de périmètre » (avertissement) ; pour aller plus loin, retraiter les trimestres quand le 10-K publie les trimestres retraités en comparatif | M | ✅ / ⏳ |
| P2-5 | Marge brute incohérente (8 sociétés) | Quand la marge brute déposée contredit CA − coût, ne plus publier le coût des ventes partiel | S | ⏳ |
| P2-6 | Actif ≠ total (4 sociétés) | Prendre actif et total passif + CP du **même** dépôt | M | ⏳ |
| P2-7 | Flux IFRS manquants (40-F) | Lire l'XBRL du dépôt pour les concepts absents | M | ⏳ |
| P2-8 | Prix non contractuels | Source licenciée si usage commercial (Polygon / Tiingo / EODHD) | — | ⏳ décision commerciale |
| P2-9 | Rafraîchissement | Déjà différencié : fondamentaux à la publication (veille EDGAR 30 min), prix 5 min / 24 h, consensus 12 h ; rien à changer | — | ✅ existant |

## P3 — optimisations futures

Segments et KPI non-GAAP ; estimations et forward P/E (sourcées et étiquetées) ; couverture hors SEC ; *buyback yield* et taux de réinvestissement au registre ; historique des tickers et radiations ; export de la provenance complète (« voir le calcul ») dans un panneau dédié.

## Vérification

* `npm test` : **1 310 tests** passent (13 ignorés : rapprochement en direct et 3 préexistants).
* `npm run reconcile` : **10 / 10** sociétés au centime, 0 identité violée.
* `npx tsc --noEmit`, `npm run lint` : propres.
