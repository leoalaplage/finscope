# FinScope — passation

État au 1 septembre 2026, fin de session. Écrit pour qu'une autre session
(Codex ou autre) reprenne sans refaire les mesures ni retomber dans les pièges.

---

## 1. Où en est le projet

Déployé sur `finscope-financial-research.leoalaplage.workers.dev`
(Cloudflare Worker + KV). `main` est la branche de travail ; tout ce qui suit
est commité et poussé.

- **642 tests** (+2 ignorés), `tsc` et `eslint` propres.
- **Cache : `KEY_VERSION = "v22"`, `SUMMARY_SHAPE = "s7"`**, aucun repli autorisé.
- 22 sociétés sur 25 en cache ; les autres se construisent seules à la demande.

### L'audit dont tout part

`AUDIT_FINSCOPE.md` (à la racine) est un audit technique en français, arrêté à
la **phase 2 sur 5**. Sa section 13 rapproche sept sociétés ligne à ligne contre
EDGAR. Les quatre défauts bloquants qu'il identifiait sont corrigés et
**revérifiés en production au chiffre près** (Apple, Berkshire, JPMorgan,
Rivian, ASML, Booking, Costco).

Les phases 3 à 5 — navigateurs, accessibilité, sécurité, performance,
licence des données de marché — **ne sont pas commencées**.

---

## 2. Les règles du code

Ce ne sont pas des préférences de style, ce sont les décisions qui tiennent le
produit. Les enfreindre casse la promesse du site.

1. **Fail closed.** Une donnée absente est *inconnue*, jamais zéro. Pas de
   `?? 0` sur un fait financier. Une case vide porte **sa raison**, écrite à
   côté d'elle.
2. **Rien n'est converti.** Un cours en dollars ne rencontre jamais des comptes
   en euros : la figure est retirée et la phrase l'explique.
3. **Aucune substitution silencieuse.** Un chiffre qui vient d'une autre base
   (moyenne diluée au lieu du nombre d'actions, exercice précédent au lieu de
   l'année glissante) le dit **sur la ligne**.
4. **Un chiffre déposé bat une inférence.** Un ratio de split est lu dans les
   dépôts, pas déduit d'un saut ; un total de dette est le concept le plus
   complet réellement publié, jamais une somme de concepts qui se recouvrent.
5. **La pédagogie se replie, les faits non.** Voir `components/Explainer.tsx` :
   « pourquoi c'est mesuré ainsi » se plie derrière un mot ; « cette société ne
   publie pas ce chiffre » reste visible.
6. **Messages de commit** : un titre qui dit ce qui change et pourquoi, puis le
   raisonnement et les mesures. Regarder `git log` pour le ton.

---

## 3. Les outils de mesure (à utiliser avant de coder)

### Le balayage de couverture

`tests/coverage-sweep.test.ts` — passe l'adaptateur sur **110 sociétés
américaines** tirées du registre SEC (les 60 plus grosses puis un échantillon
jusqu'aux plus petites) et classe ce qu'un lecteur obtiendrait.

```bash
node scripts/fetch-coverage-sample.mjs /tmp/finscope-coverage   # ~1 Go, une fois
COVERAGE_FIXTURES=/tmp/finscope-coverage npx vitest run tests/coverage-sweep.test.ts --reporter=verbose
```

Il s'ignore tout seul sans les fixtures, donc il ne casse pas la CI.
**Dernier relevé** (avant le correctif des splits) :

| classe | part | exemples |
|---|---|---|
| complètes | 28 % | AAPL, MSFT, AMZN, ASML, COST |
| pas de nombre d'actions à la clôture | 18 % | NVDA, META, WMT, V, KO |
| pas de flux de trésorerie disponible | 13 % | banques (voulu), COP, PSX, CRH |
| pas de total de dette | 12 % | ANET, VEEV, PLTR, BRK-B, IBKR |
| normes IFRS → rien | 10 % | HSBC, SAP, AZN, SHEL, NVO, UBS |
| aucune période annuelle | 5 % | XOM et 4 microcaps |

### Le remplissage du cache

`scripts/warm-cache.mjs`. **Rythme obligatoire** : 30 s entre deux
constructions, 3 minutes de recul après un refus. Mesuré : une construction
toutes les 18 s tient quinze sociétés puis mur ; et un script qui continue à
frapper pendant un refus n'obtient plus rien.

```bash
node scripts/warm-cache.mjs NVDA AAPL GOOGL …
```

**Ne jamais le lancer pendant que quelqu'un utilise le site.**

---

## 4. Ce qui a été fait cette session (et pourquoi)

Dans l'ordre, avec les mesures.

| correctif | effet mesuré |
|---|---|
| Fail closed (dette, trésorerie, actions, devise) | JPMorgan ne sort plus à −343 Md$ de dette nette |
| Revenu Berkshire | 247 → **371 Md$**, réconcilié dans la provenance |
| Nombre d'actions à la clôture (`CommonStockSharesOutstanding`) | 10 sociétés récupèrent un vrai compte |
| Période courante = la plus récente | JPMorgan n'affiche plus 2014 ; capitalisation 1 320 → **960 Md$** |
| Lecture de la dette élargie | sans total : **27 % → 12 %** |
| Splits lus dans les dépôts | séries continues : **68 → 75** sur 91 ; EPS 2019 d'Amazon 22,99 → **1,15 $** |
| Capex : 2 concepts de plus | flux disponible : 74 % → **78 %** |
| Invariants non stockés | société 25 % plus légère, aucune information perdue |
| Ne plus dessiner la mauvaise société | 5 → **3 requêtes**, plus de chiffres d'Apple sous une URL Microsoft |
| Prose repliée | onglet Statistics : **245 → 37 mots** |
| Cibles tactiles | sous 32 px : **23 → 0** |
| Construction hors requête | plus de 1102 pour le lecteur : 202 en 0,66 s |
| Retombée de période bornée | valeur du dernier exercice, **avec sa date**, 18 mois maximum |

### Fonctionnalité ajoutée

**« What moved the share price »** (`lib/price-drivers.ts` +
`components/PriceDrivers.tsx`, onglet Statistics). D'après *The Quality Growth
Investor* : cours = flux par action ÷ rendement exigé, donc un cours ne bouge
que de deux façons. Le panneau sépare ce que l'entreprise a produit de ce que
le marché a décidé de payer, en multiplicateurs vérifiables de tête, avec un
verdict (« gagné par l'entreprise » / « payé par le marché »). Les quatre
exemples chiffrés du livre sont les tests.

---

## 5. Les pièges déjà payés — ne pas les repayer

1. **Le split déclaré n'est pas un événement.** Tesla tague son ratio contre
   *chaque* fin de trimestre (15 fois), Alphabet contre l'annonce *et* la date
   d'effet. Appliqués tels quels : historique de Tesla à zéro, Alphabet ×400.
   Règle retenue : un ratio n'est appliqué que s'il **explique une rupture
   réelle** dans la série d'actions, et après les splits vérifiés à la main.
2. **Une retombée de période sans borne remonte à 2013.** Arista offrait une
   dette nette de 2013 à côté d'une capitalisation de 2026. Borne : 18 mois.
3. **`DebtCurrent` n'est pas un emprunt court terme additionnel** : c'est la
   dette à moins d'un an, échéances courantes comprises. L'ajouter à
   `LongTermDebtCurrent` sortait NVIDIA à 9 467 M$ au lieu de 8 468.
4. **Le CSS se lit dans l'ordre.** Un bloc `@media (pointer: coarse)` inséré
   au milieu du fichier perd contre les règles de base qui suivent. Il est en
   **fin de feuille**, il doit y rester.
5. **Déployer depuis `HEAD`, pas depuis le dossier de travail** — sinon on
   embarque le travail en cours de quelqu'un d'autre :
   ```bash
   git archive HEAD | tar -x -C /tmp/finscope-deploy
   ```
6. **Un bump de `KEY_VERSION` vide tout le cache.** Trois bumps en une soirée
   ont donné trois vagues de « Building financials… ». Grouper les changements
   de normalisation dans **un seul** déploiement, puis réchauffer.
7. Le poids réseau **n'est pas** un problème : 5 Mo de société voyagent en
   265 Ko compressés. Ne pas optimiser là.

---

## 6. Ce qui reste, par ordre de valeur

1. **L'architecture de la page société** — la seule chose que je n'ai pas
   tranchée seule : 6 onglets, l'Overview recoupe Statistics. La question à
   poser au propriétaire du produit : *que doit-on voir dans les cinq premières
   secondes ?* Tout le reste en découle.
2. **Le nombre d'actions à la clôture manquant pour 18 %** des sociétés
   (multi-classes : META, V, MA, KO…). La donnée existe en couverture de
   rapport (`dei:EntityCommonStockSharesOutstanding`), datée du dépôt et non de
   la clôture, donc rejetée par l'ancrage actuel. La lire en la datant
   correctement est un gain net.
3. **Les sociétés IFRS (10 %)** — HSBC, SAP, AstraZeneca, Shell, Novo Nordisk,
   UBS. Cotées à New York, invisibles ici. Mapper `ifrs-full` est un chantier
   en soi, pas une correction.
4. **Les changements de CIK.** ExxonMobil s'est réorganisée : le registre SEC
   pointe vers une entité neuve qui ne contient qu'un trimestre, toute
   l'histoire est sous l'ancien numéro. Il faut savoir suivre le prédécesseur.
5. **Sortir le constructeur dans son propre Worker.** Le lien `SELF` existe
   déjà et la construction est déjà déportée ; en faire un Worker distinct
   isolerait complètement ses saturations du chemin de lecture.
6. **Phases 3 à 5 de l'audit** : mobile réel, accessibilité, sécurité,
   performance, licence Yahoo.

---

## 7. Contexte d'exploitation

- **Déploiement** : `npm run build` puis
  `npx wrangler deploy --config dist/server/wrangler.json`, depuis une copie de
  `HEAD`. Le Bureau étant synchronisé iCloud, construire **hors** du Bureau
  (`/tmp`), sinon rien n'aboutit.
- **Accès macOS** : l'accès au dossier `~/Desktop` a été révoqué en cours de
  session (Réglages → Confidentialité → Fichiers et dossiers). La copie locale
  peut être en retard : `git pull`.
- **Erreur 1102** = le Worker dépasse ses limites (128 Mo par isolat, partagés).
  Une construction consomme ~48 Mo et 200-500 ms de CPU. C'est réglé côté
  lecteur ; ça peut encore arriver si on construit plusieurs sociétés en
  rafale.
- **Deux sessions en parallèle sur le même dépôt, c'est cher** : trois bumps de
  cache et plusieurs commits croisés viennent de là. Une seule à la fois, ou
  des fichiers strictement disjoints.
