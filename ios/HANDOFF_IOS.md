# FinScope iOS — passation

État au 4 septembre 2026. Écrit pour qu'une autre session reprenne sans
refaire les mesures.

---

## 1. Ce qui tourne

`ios/FinScope.xcodeproj`, cible iOS 18, Swift 6 en concurrence stricte, aucune
dépendance tierce. Vérifié sur simulateur iPhone 17 Pro (iOS 26.5) :

- **36 tests passent** (`ContractDecodingTests`, `VerticalSliceTests`,
  `PresentationTests`).
- Le premier parcours est complet : Search → AAPL → Quality Score → graphiques
  Revenue / FCF / ROIC → Watchlist → fermeture → réouverture → Apple est là.
- Quatre onglets, une `NavigationStack` par onglet, liens profonds
  `finscope://stock/AAPL`, `finscope://screener`, `finscope://watchlist`.

Le projet vit hors iCloud pour compiler : copier `ios/` dans `/tmp` avant
`xcodebuild`, sinon la synchronisation interrompt la compilation.

```bash
cp -R ios /tmp/build-ios && cd /tmp/build-ios \
  && xcodebuild -project FinScope.xcodeproj -scheme FinScope \
     -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test
```

### Captures sans y toucher

`-ui-route` et `-ui-seed-watchlist` (DEBUG uniquement, `RootView`) ouvrent
n'importe quel écran au lancement, avec les vraies dépendances :

```bash
xcrun simctl launch <udid> app.finscope.ios \
  -ui-seed-watchlist -ui-route score -ui-ticker CME
```

---

## 2. La règle que le code porte

La première règle du produit — *une donnée absente est inconnue, jamais zéro,
et la case vide porte sa raison* — n'est pas un commentaire ici, c'est le
système de types.

- `MetricValue` a une `value` optionnelle et une `reason` non-nulle exactement
  quand la valeur est nulle.
- `MetricTile` n'a **aucun** initialiseur prenant un `Double?` nu. Une vue ne
  peut pas dessiner un blanc sans qu'on lui ait donné quoi dire à sa place.
- `Fetched<Value>` enveloppe chaque payload avec sa `Freshness`. Un écran ne
  peut pas recevoir des chiffres sans recevoir leur date.

CME est le cas de contrôle : une bourse, donc ROIC / FCF / dette nette
indisponibles avec « borrowing is an input to this business, not a burden on
it », 23 % de couverture en rouge, et **NR en gris** — pas une mauvaise note,
l'absence de note.

**L'app ne calcule aucun chiffre financier.** Les seuls calculs locaux sont la
variation entre deux points déjà reçus (`SectionDetailView`) et le formatage.

---

## 3. L'architecture

```text
View → ViewModel (@Observable, @MainActor) → Repository (protocole)
                                              ↙            ↘
                                    FixtureRepository   LiveRepository → APIClient
```

`AppDependencies.live(container:)` est le **seul** endroit qui choisit. Il
retourne aujourd'hui `FixtureRepository()` ; le jour où `/v1` répond, cette
ligne devient `LiveRepository(api: APIClient(), cache: cache)` et rien d'autre
ne bouge. Aucun écran, aucun ViewModel, aucun test ne sait lequel tourne.

`LiveRepository` implémente déjà cache-first / network-refresh : copie locale
rendue immédiatement, réseau ensuite, `304` qui ne déplace que la date de
lecture, échec réseau qui renvoie la copie datée et marquée plutôt que de
vider l'écran.

---

## 4. Les fixtures

`ios/Tools/record-fixtures.mjs` écrit `ios/Fixtures/v1/`. Il **appelle** le
moteur, il ne le réimplémente pas : datasets du Worker déployé, métriques via
`lib/finance.ts`, scores via `lib/qs/*` sur l'univers couvert. Aucun chiffre
n'est inventé — c'est ce qui permet de juger un écran avant que `/v1` réponde.

```bash
node --import tsx ios/Tools/record-fixtures.mjs
```

Elles vivent **hors** du groupe synchronisé Xcode, en référence de dossier.
Un groupe synchronisé aplatit ses ressources à la racine du bundle, ce qui
faisait entrer en collision quatre fichiers nommés `summary.json` ; et un
répertoire dans `membershipExceptions` n'exclut rien.

---

## 5. Le point de raccord avec Codex — à décider

`contracts/v1/` existe maintenant (travail Codex, non commité au moment où
ceci est écrit). Le contrat est bon et proche du nôtre, mais **trois écarts**
séparent nos DTO des siens :

| Point | Ce que l'app lit | Ce que `contracts/v1` publie |
|---|---|---|
| Enveloppe | objet plat | `{ meta, data }` |
| Métriques d'une fiche | tableau `keyMetrics` ordonné | dictionnaire `metrics` clé → valeur |
| Absence | `null` + `status` + **`reason`** | `null` + `status: "unavailable"`, sans raison |

Les deux premiers sont du travail mécanique côté iOS — les DTO sont le seul
endroit qui connaît la forme du JSON, la couche domaine ne bouge pas.

**Le troisième est une décision produit.** Sans raison sur le fil, l'app ne
peut qu'écrire « No reason was given for this gap. » à côté d'une case vide,
ce qui est exactement ce que le site refuse de faire depuis le début
(`HANDOFF.md` §2, règle 1). Le recorder actuel fabrique ces raisons côté iOS ;
elles devraient venir du serveur, qui seul sait *pourquoi* un chiffre manque —
métier non comparable, concept non publié, période absente.

À trancher : `/v1` porte-t-il un champ `reason` (ou `unavailableReason`) à côté
de `status: "unavailable"` ? Si oui, le recorder disparaît et les DTO le lisent
directement.

---

## 6. Ce qui n'est pas fait

- Le raccordement effectif à `/v1` (voir §5).
- Pagination par curseur du screener : `ScreenerPage.cursor` existe et
  `LiveRepository` l'envoie, mais aucune vue ne charge une deuxième page —
  l'univers tient en 21 lignes.
- Comparaison de deux ou trois sociétés depuis le screener.
- Catalogue de chaînes localisées : les textes sont en dur, en anglais.
- Icône d'application.
- `Quotes` : `/v1/quotes` n'est pas encore consommé ; le cours vient du
  `summary`.

## 7. Ce qu'il ne faut pas faire

Les règles de la mission, qui tiennent toujours : ne pas recalculer une
métrique en Swift, ne pas rejouer le Quality Score, ne pas embarquer de clé
d'API, ne pas transformer chaque observation en entité SwiftData (les gros
payloads sont des fichiers dans `Application Support`, SwiftData n'en garde
que l'index), ne pas modifier le backend, `lib/`, le Worker ou Lume.
