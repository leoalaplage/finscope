# FinScope — audit avant refonte

Phase 1. Écrit le 2 septembre 2026, avant toute modification de code.
Tout ce qui suit est mesuré sur le dépôt et sur la production, pas estimé.

---

## 1. Ce qu'est FinScope aujourd'hui, en chiffres

| | |
|---|---|
| pages (routes) | **1** — `app/page.tsx` |
| composants | 26 fichiers, **6 091 lignes** |
| plus gros composant | `FinanceApp.tsx`, **877 lignes** |
| feuille de style | `globals.css`, **1 603 lignes**, 76 variables, **50 couleurs** |
| routes API | 11 |
| tests | 46 fichiers, 642 tests verts |
| onglets par société | 6 |
| hauteur de l'onglet Overview | **7 530 px**, 15 cartes |
| conteneur central | `min(100% − 40px, 1320px)` → **20 px de marge latérale** |

### L'architecture réelle

Il n'y a **aucune route**. L'application entière est un composant client de 877
lignes qui garde la vue courante en état React et écrit l'URL à la main avec
`history.pushState`. Conséquences directes :

- pas de rendu serveur par société (une page société n'existe pas côté serveur) ;
- `FinanceApp.tsx` concentre navigation, chargement, état, et le rendu de la
  page société — c'est là que vit la complexité ;
- chaque écran est monté/démonté par des conditions `view === "..."`.

Ce n'est pas irrécupérable, mais c'est le premier obstacle à une refonte propre.

---

## 2. Ce qui fonctionne vraiment — à ne pas toucher

Le moteur financier est la partie solide du projet. Il ne doit pas bouger.

- **`lib/adapters/sec.ts`** — lecture des Company Facts, choix des concepts,
  reconstruction de la dette, des trimestres, des splits. Corrigé et vérifié
  contre les dépôts pour sept sociétés au chiffre près.
- **`lib/periods.ts`** — construction annuel / trimestriel / TTM, isolation du
  Q4, retraitement des splits.
- **`lib/finance.ts`** — toutes les formules, avec les règles fail-closed.
- **`lib/market-basis.ts`**, `lib/valuation-history.ts`, `lib/price-drivers.ts`,
  `lib/company-statistics.ts`, `lib/dcf.ts`, `lib/qs-export.ts`.
- **`lib/dataset-cache.ts`** et le Worker — cache KV, crons, construction hors
  requête. Réglé hier ; ne pas y retoucher sans raison.
- Les **46 fichiers de test** : ils encodent les décisions, pas seulement le code.

**Règle de la refonte : la couche données est en lecture seule.** Si une vue a
besoin d'un chiffre qui n'existe pas, on l'ajoute dans `lib`, on le teste, on ne
le calcule pas dans un composant.

---

## 3. Ce qui est cassé, mort ou en trop

### Code mort — à supprimer

| élément | taille | état |
|---|---|---|
| `components/PortfolioPage.tsx` | **543 lignes** | importé nulle part, inaccessible |
| `lib/portfolio.ts` + CSS associé | ~120 lignes | idem |
| `app/api/fx` | route | appelée par **zéro** fichier |
| `db/schema.ts`, `drizzle/` | — | schéma vide, base jamais branchée |

Le portefeuille est la 3ᵉ plus grosse vue du projet et personne ne peut y
accéder. C'est soit une fonctionnalité à assumer, soit 660 lignes à retirer.

### Ce qui n'existe pas du tout

- **Aucune authentification.** Pas de compte, pas de session, pas de mot de
  passe. Rien dans le code.
- **Aucune base de données.** `db/schema.ts` dit littéralement *« Intentionally
  empty by default »*.
- **Aucune persistance serveur.** Watchlist, thème, colonnes, scénarios de DCF,
  graphiques : **12 clés `localStorage`**, par navigateur. Changer d'appareil =
  tout perdre.

### Redondances

- **Overview / Statistics / Financials** disent en partie la même chose :
  revenus, marges, flux, par action. Trois onglets, trois présentations.
- **L'onglet Sources** (4 lignes de tableau) double le panneau *Sources* du pied
  de page.
- **Quatre panneaux secondaires** (Data Quality, Formula Audit, Import status,
  Sources) atteignables uniquement par le pied de page. Réels, mais périphériques.
- **10 fichiers** instancient leur propre `Intl.NumberFormat`, **6** refont le
  format compact. Aucun système de formatage central.

---

## 4. Le design system : ce qu'il y a, ce qui manque

Il existe déjà une base sérieuse : 76 variables, une échelle typographique
nommée, un accent unique, des règles de thème clair/sombre. Ce n'est pas à jeter.

Ce qui ne va pas :

1. **50 couleurs déclarées.** Bien au-delà de ce qu'une interface financière
   demande (neutre + accent + vert + rouge).
2. **Une typographie trop petite pour du premium.** Corps à 14 px, valeurs
   denses à 13 px, légendes à 11 px, micro à 10 px. Une lecture Apple-like
   commence plutôt à 15-17 px pour le corps.
3. **20 px de marge latérale.** C'est ce qui donne la sensation de « collé ».
4. **Pas d'échelle d'espacement.** Aucune variable `--space-*` : les marges sont
   écrites à la main partout (`36px`, `18px`, `12px`, `6px`…).
5. **Pas de composants partagés.** Pas de `Card`, `MetricCard`, `DataTable`,
   `Tabs`, `EmptyState`, `Badge`. Chaque écran redessine les siens en CSS.
6. **1 603 lignes de CSS global** sans découpage : tout écran dépend de tout.

---

## 5. Ce que je propose de supprimer

Conformément à « la refonte doit aussi être une simplification » :

- le **portefeuille** (code mort) ;
- l'onglet **Sources** de la page société (doublon du pied de page) ;
- les **diagrammes Sankey** des états financiers : jolis, lourds, et moins
  lisibles qu'un tableau pour comprendre un compte de résultat ;
- l'onglet **Statistics** en tant qu'onglet séparé : son contenu se répartit
  entre Overview (les repères) et une page **Quality** ;
- la route **`/api/fx`** ;
- le schéma de base **vide** et Drizzle, tant qu'il n'y a pas de compte.

---

## 6. L'architecture cible

### Navigation principale — 4 entrées, pas 5 + 4 panneaux

```
Search    Watchlist    Screener    Charts
```

*Market* (indices + treemap) est un produit différent de l'analyse
fondamentale : il rejoint la page d'accueil ou disparaît. Les quatre panneaux
du pied de page deviennent **un** écran *Data & sources*, atteignable depuis le
pied de page, pas dans la navigation.

### Page société — 4 onglets au lieu de 6

```
Overview        vue d'ensemble : taille, croissance, rentabilité, cash, valorisation
Financials      compte de résultat, bilan, flux — tableaux, annuel/trimestriel
Quality         marges, retours sur capital, dette, dilution, allocation du capital
Valuation       multiples et leur historique, rendement, DCF
```

### Overview — la promesse des 30 secondes

Dans cet ordre, sur une seule page qui tient en deux écrans :

1. **En-tête** : nom, ticker, place, cours, variation du jour, capitalisation,
   bouton watchlist.
2. **Six repères** en ligne : Revenus, FCF, EPS, marge brute, ROIC, actions en
   circulation — chacun avec sa valeur, sa variation et sa période.
3. **Trois graphiques larges** : Revenus, Résultat net, Free Cash Flow —
   barres, valeurs au-dessus, croissance annualisée affichée.
4. **Marges dans le temps** — une ligne par marge, 5/10 ans/max.
5. **Ce qui a fait le cours** — le panneau existant, qui est déjà la bonne idée.
6. **Valorisation en une ligne** : P/E, P/FCF, EV/EBIT, rendement du FCF, avec
   la moyenne 5 ans à côté.

Pas de Sankey, pas de 15 cartes, pas de 7 500 px de hauteur.

---

## 7. Ce que la refonte ne peut pas honorer telle quelle

Trois points du cahier des charges **supposent un backend qui n'existe pas** :

- **§15 watchlist persistante** — aujourd'hui `localStorage`. « Ajouter /
  supprimer uniquement si ces actions sont réellement sauvegardées » : elles le
  sont, mais par navigateur.
- **§16 authentification et espace client** — il n'y a rien à auditer, tout est
  à construire : comptes, sessions, mots de passe, base de données.
- **§14 colonnes personnalisables du screener** — existe partiellement dans le
  tableau de classement, avec persistance locale uniquement.

**Deux voies, à trancher :**

**A. Refonte sans compte (recommandé maintenant).** On retire *Account*, *Sign
in*, *Sign up* de l'interface. La watchlist reste locale et le dit clairement.
Rien de faux à l'écran, produit cohérent, livrable rapidement.

**B. Ajouter un vrai backend utilisateur.** Cloudflare D1 est déjà déclaré,
Drizzle est déjà installé, le schéma est vide et prêt. Comptes, sessions,
watchlists serveur : c'est un chantier à part entière, à faire *après* la
refonte visuelle et non pendant.

Faire de la fausse authentification serait exactement ce que le cahier des
charges interdit. Je pars sur **A** sauf indication contraire.

---

## 8. Le plan, avec ses critères d'acceptation

Chaque phase est déployée et vérifiée avant la suivante.

| phase | contenu | vérifié par |
|---|---|---|
| **1** | cet audit | — |
| **2** | design system : espacement, typographie, couleurs réduites, composants partagés (`Card`, `MetricCard`, `DataTable`, `Tabs`, `EmptyState`, `Badge`), formatage financier centralisé | un seul module de formatage ; ≤ 20 couleurs ; échelle d'espacement appliquée |
| **3** | shell : conteneur, marges, navigation à 4 entrées, recherche globale, responsive | marges ≥ 32 px ; aucune cible tactile < 44 px ; navigation sans doublon |
| **4** | **Company Overview** | hauteur ≤ 2 écrans ; les 7 informations clés visibles sans clic ; aucun texte explicatif déplié par défaut |
| **5** | Financials + Quality (marges, retours, dette, dilution) | tableaux lisibles, annuel/trimestriel, colonne figée, YoY |
| **6** | Valuation + DCF | hypothèses visibles et modifiables ; valeur intrinsèque, cours, écart |
| **7** | Screener + Watchlist | table compacte, filtres essentiels, ajout/suppression réels |
| **8** | suppression du code mort, nettoyage CSS | `PortfolioPage`, `/api/fx`, Sankey, onglet Sources retirés |
| **9** | QA complète | toutes les routes, tous les boutons, console vide, build vert, 642 tests toujours verts |

**Non négociable à chaque phase :** aucun bouton mort, aucune donnée inventée,
aucun état vide sans explication, et les tests existants restent verts.

---

## 9. Deux contraintes d'exécution

1. **Accès disque.** macOS a révoqué l'accès à `~/Desktop` : je travaille depuis
   un clone dans `/private/tmp/finscope-work` et je pousse sur `main`. À
   rétablir dans Réglages → Confidentialité → Fichiers et dossiers, sinon la
   copie locale reste en retard (`git pull`).
2. **Une seule session à la fois** sur ce dépôt. Les collisions d'hier ont coûté
   trois reconstructions de cache complètes.
