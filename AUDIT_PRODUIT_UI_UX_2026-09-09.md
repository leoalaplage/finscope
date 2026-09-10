# FinScope — audit produit, UI/UX et roadmap de fonctionnalités

Date : 9 septembre 2026

## Verdict

FinScope possède déjà son actif le plus difficile à construire : un moteur de
données financières prudent, traçable et différencié. Le produit fonctionne,
les parcours principaux sont cohérents et la base technique est saine.

Le prochain gain ne viendra pas d'ajouter encore plus de chiffres. Il viendra
de trois changements : rendre l'interface lisible et réellement mobile, aider
l'utilisateur à comprendre quoi regarder, puis transformer une consultation
ponctuelle en suivi régulier grâce aux listes, scénarios, notes et alertes.

Priorité recommandée : **corriger les fondations UX/accessibilité avant de
construire de nouvelles fonctions**. Sinon chaque nouvelle fonction agrandira
une interface déjà très dense.

## Périmètre vérifié

- Lecture du code Next.js/vinext, des composants et des deux audits précédents.
- Test local et vérification de la version publiée.
- Parcours testés : accueil, recherche, marché, fiche AAPL, comparaison,
  screener, DCF, portefeuille et réglages.
- Vérifications desktop à 1440 × 900 et mobile à 390 × 844.
- Vérification du DOM accessible, des débordements, des zones tactiles, des
  états vides, des temps d'attente et de la console.
- Tests, lint, TypeScript, build, dépendances et principaux poids de fichiers.

Cet audit ne contient pas de mesure Core Web Vitals de laboratoire : le traceur
Chrome DevTools requis n'est pas configuré dans cet environnement. Les constats
de performance ci-dessous reposent donc sur la production, les réponses HTTP et
les artefacts de build, pas sur un score Lighthouse.

## Scorecard

| Axe | Note | Lecture |
|---|---:|---|
| Valeur produit | 8/10 | Données officielles, provenance et refus d'inventer : très différenciant |
| Fiabilité technique | 9/10 | Tests, typage, lint et build verts ; aucune vulnérabilité de production signalée |
| Architecture de l'information | 6/10 | Beaucoup de valeur, mais un très long flux expert sans repères persistants |
| UI desktop | 7/10 | Direction visuelle forte et cohérente, mais hiérarchie trop discrète |
| UX mobile | 4/10 | Navigation masquée, cibles trop petites et DCF qui déborde de la page |
| Accessibilité | 4/10 | Contraste, taille du texte, navigation clavier et dialogues à corriger |
| Activation / rétention | 5/10 | Recherche efficace, mais peu d'onboarding, de sauvegarde et de suivi |
| SEO / partage | 5/10 | Métadonnées de base présentes, mais pas de sitemap ni de cartes sociales par société |

## Ce qu'il faut garder

1. **La promesse de données traçables.** Les liens EDGAR, les dates, la base de
   cours et les refus en cas de donnée incompatible créent de la confiance.
2. **La recherche universelle.** La recherche par ticker ou nom fonctionne,
   répond vite une fois hydratée et ouvre tout le registre SEC.
3. **La séparation des horloges.** Cours, déclarations et données de marché ont
   des caches et rythmes différents ; c'est une bonne architecture produit.
4. **Le DCF inversé.** « What the price implies » est plus utile et plus
   différenciant qu'un DCF générique rempli d'hypothèses arbitraires.
5. **La comparaison partageable.** Les sociétés sélectionnées vivent dans
   l'URL ; c'est le bon modèle à étendre aux autres outils.
6. **Le traitement local des préférences et du portefeuille.** La confidentialité
   est claire et cohérente avec un produit de recherche personnel.
7. **Le design monochrome.** Il donne une identité forte. Il faut améliorer sa
   lisibilité, pas le remplacer par un dashboard multicolore générique.

## Problèmes prioritaires

### P0 — mobile et accessibilité

#### 1. Navigation mobile partiellement invisible

À 390 px, la barre contient six destinations dans un rail horizontal sans
indication visuelle de défilement. `Portfolio` se trouve hors écran et les
boutons thème/réglages occupent la zone de droite. Aucun lien ne porte
`aria-current`, donc l'utilisateur ne sait pas clairement où il se trouve.

**Décision recommandée :** garder au maximum quatre destinations visibles et
placer le reste dans un bouton « More », ou utiliser une barre de navigation
mobile dédiée. Ajouter l'état actif et conserver la recherche comme action
globale.

#### 2. Cibles tactiles trop petites

Les commandes thème et réglages mesurent 28 × 28 px, l'édition de watchlist
20 × 20 px, les plages du graphique environ 32 × 24 px et de nombreux boutons
de tableau seulement 16 px de haut. Cela rend les erreurs de toucher probables.

**Décision recommandée :** surface interactive minimale de 44 × 44 px sur
mobile, même si le glyphe visuel reste petit.

#### 3. Texte secondaire trop petit et trop peu contrasté

Le système utilise largement du 10–11 px. Le token `--ink-3` donne un contraste
de 3,17:1 sur fond noir et de 2,69:1 sur fond blanc, sous le seuil AA de 4,5:1
pour du texte normal. Cela affecte précisément les informations de confiance :
dates, sources, notes, statuts et explications.

**Décision recommandée :** passer le texte utile à 12 px minimum dans les
tableaux et 14 px pour le texte courant, relever `--ink-3` à au moins 4,5:1 et
réserver le 10 px aux éléments purement décoratifs.

#### 4. DCF cassé horizontalement sur mobile

À 390 px, le document mesure 419 px. Les taux 8 %, 10 % et 12 %, plusieurs
cellules et une partie des contrôles sont hors écran. Le débordement ne reste
pas contenu dans la table : toute la page devient horizontalement scrollable.

**Décision recommandée :** empiler le libellé, l'hypothèse et le choix de taux,
contenir la matrice dans son propre rail, figer la première colonne et ajouter
une ombre ou un libellé « swipe to compare » au premier affichage.

#### 5. Dialogues et recherche incomplets au clavier

Les éditeurs de watchlist et de portefeuille ont `role="dialog"`, mais ne
gèrent ni focus initial, ni piège de focus, ni fermeture avec Échap. La liste
de recherche expose des options, mais pas d'`aria-activedescendant` reliant le
champ au résultat actif. Il n'existe pas non plus de lien d'évitement vers le
contenu principal.

**Décision recommandée :** utiliser une primitive de dialogue accessible,
annoncer l'option active de la recherche, ajouter un skip link et vérifier
l'intégralité du parcours au clavier.

### P0 — clarté et confiance

#### 6. La promesse absolue dépasse encore la couverture réelle

« Every US filer. Every filed figure. » est mémorable, mais les documents du
projet reconnaissent encore des limites IFRS, des changements de CIK et des
extensions XBRL non couvertes. Une promesse absolue et une couverture prudente
se contredisent.

**Décision recommandée :** garder la force du slogan, puis ajouter une ligne de
preuve immédiatement visible, par exemple : « SEC XBRL · US-GAAP coverage · no
estimates · every number linked to its filing ». Afficher aussi la couverture
et les exceptions au niveau de chaque société.

#### 7. La fiche société est un flux très long sans carte de lecture

La fiche AAPL contient cours, valorisation, score, santé, croissance par action,
historique de valorisation, croissance, états financiers, initiés, détenteurs et
actualités. La richesse est excellente, mais l'utilisateur n'a ni sous-navigation
collante, ni résumé « ce qui a changé », ni moyen de replier les blocs avancés.

**Décision recommandée :** ajouter une sous-navigation `Overview / Valuation /
Financials / Ownership / News`, conserver les trois à cinq réponses décisives
au-dessus de la ligne de flottaison et replier les détails avancés sans les
supprimer.

#### 8. Les actualités sont des impasses

Les titres de la newsroom et du marché sont volontairement non cliquables. Un
utilisateur qui voit un événement important ne peut pas lire la source. Cela
affaiblit la promesse de traçabilité.

**Décision recommandée :** rendre chaque titre cliquable vers la source
originale vérifiée, avec domaine et date. Ne pas transformer le produit en
agrégateur d'articles.

#### 9. Les comptes sont présentés mais inutilisables

La page Settings affiche email, mot de passe, « Create account » et « Sign in »,
tous désactivés. Cela ressemble davantage à une fonction cassée qu'à une
fonction future.

**Décision recommandée :** retirer le formulaire jusqu'à ce que la synchronisation
existe, ou le remplacer par une seule explication et une liste d'attente. Ne
réintroduire l'authentification qu'avec un bénéfice concret : sauvegarde,
synchronisation ou alertes.

### P1 — activation et efficacité

#### 10. La page d'accueil ne dit pas ce que la watchlist permet de décider

Les 27 cartes ne montrent que le ticker et le secteur. Sur mobile, cela devient
neuf rangées sans prix, variation, grade ou signal de fraîcheur.

**Décision recommandée :** afficher d'abord `Recently viewed` et une watchlist
personnelle plus courte. Proposer un mode compact contenant prix, variation du
jour, grade et indicateur de valorisation, avec accès à la liste complète.

#### 11. Les états vides n'enseignent pas le produit

Le portefeuille vide dit seulement qu'il faut un ticker et un nombre d'actions.
Il n'explique pas le résultat obtenu : exposition sectorielle, FCF détenu,
concentration, qualité pondérée et comparaison au S&P 500.

**Décision recommandée :** montrer un exemple non sauvegardé, accepter un collage
depuis un courtier/CSV et expliquer en trois bénéfices ce que l'analyse produira.

#### 12. Les scénarios DCF ne sont pas partageables

L'URL mémorise la société, mais pas le taux requis, la croissance supposée ni le
scénario sélectionné. Deux personnes ouvrant le même lien ne lisent donc pas
forcément la même hypothèse.

**Décision recommandée :** sérialiser les hypothèses dans l'URL, ajouter
`Copy scenario` et permettre de nommer `Bear / Base / Bull` sans rendre l'écran
principal plus complexe.

## Liste priorisée des fonctionnalités

| Priorité | Fonctionnalité | Valeur utilisateur | Effort estimé |
|---|---|---|---:|
| 1 | Sous-navigation et résumé décisionnel sur la fiche société | Trouver la réponse en quelques secondes | M |
| 2 | Scénarios DCF sauvegardés et partageables | Reproduire une thèse et discuter les hypothèses | M |
| 3 | Plusieurs watchlists avec noms, tags et vues compactes | Organiser un univers d'investissement réel | M |
| 4 | Alertes sur nouveaux filings, initiés et seuils de valorisation | Transformer FinScope en outil de suivi régulier | L |
| 5 | Notes de recherche par société avec liens vers les chiffres sources | Construire une thèse, des risques et des catalyseurs | M |
| 6 | Export CSV/XLSX/PDF avec provenance et date | Réutiliser l'analyse sans perdre la source | M |
| 7 | Filtres et poids personnalisés dans le screener | Passer de trois presets à une stratégie personnelle | M |
| 8 | Timeline société : filings, résultats, communiqués, initiés | Comprendre ce qui a changé et pourquoi | M |
| 9 | Import portefeuille CSV et lots avec date/prix | Éviter la saisie manuelle et fiabiliser le rendement | L |
| 10 | Comptes et synchronisation multi-appareils | Sauvegarder listes, scénarios, notes et alertes | L |
| 11 | Assistant de recherche strictement sourcé | Interroger les filings et obtenir chaque réponse avec citation | XL |
| 12 | Support IFRS et historique des changements de CIK | Rendre la promesse de couverture réellement universelle | XL |

### Détail des cinq meilleures opportunités

#### A. Résumé décisionnel

Créer un bloc compact au sommet de la fiche : qualité, croissance, santé,
valorisation, principaux changements depuis le dernier filing et niveau de
couverture. Chaque phrase doit ouvrir la preuve correspondante.

#### B. Alertes utiles, pas des notifications génériques

Permettre des alertes sur : nouveau 10-Q/10-K/8-K, achat/vente d'initié,
franchissement d'un multiple ou rendement FCF, changement de grade, variation
anormale d'une métrique fondamentale. Commencer par un centre d'alertes dans le
produit ; email/push peuvent venir après l'authentification.

#### C. Carnet de thèse

Pour chaque ticker : thèse, risques, catalyseurs, prix cible/scénario, date de
revue et métriques suivies. Une note peut référencer un chiffre FinScope et
conserver sa période, sa source et sa valeur au moment de l'ajout.

#### D. Screener personnalisable

Ajouter des filtres explicites (`FCF yield > 4%`, `ROIC > 15%`, `dilution < 0`,
couverture minimale), des poids enregistrables et des écrans sauvegardés. Les
presets actuels restent les raccourcis d'entrée.

#### E. Export avec preuve

Exporter la comparaison, le DCF, le screener et les états financiers. Chaque
export doit inclure ticker, période, unité, devise, statut calculé/reporté,
date de récupération et URL EDGAR. C'est une extension naturelle de la promesse
de traçabilité.

## Ce qu'il faut modifier ou retirer

| Élément actuel | Décision recommandée |
|---|---|
| `Company` dans la navigation | Renommer `Last company` avec le ticker, ou retirer si aucune société n'a été ouverte |
| Formulaire de compte désactivé | Retirer jusqu'à disponibilité ; afficher un bénéfice et une seule CTA |
| 27 sociétés par défaut sur l'accueil | Remplacer par récent + favoris ; garder la liste complète sur Market/Screener |
| Actualités sans lien | Relier à la source originale vérifiée |
| Longue fiche en une seule colonne | Ajouter une sous-navigation et replier les détails avancés |
| Tables horizontales | Garder le scroll, mais figer la clé et montrer clairement qu'il existe |
| Monochrome strict | Conserver ; relever contraste et taille, utiliser icônes/texte plutôt que la couleur seule |
| `/research` | Garder comme espace expert/interne, sans le remettre au centre du produit public |

## Ce qu'il ne faut pas ajouter maintenant

- Une exécution d'ordres ou connexion courtier : forte complexité réglementaire
  et hors du cœur « comprendre les filings ».
- Un chatbot financier générique : il diluerait la confiance. Un assistant ne
  vaut la peine que s'il cite chaque réponse dans les données et filings.
- Davantage de cartes décoratives sur l'accueil : le problème est la priorité
  de lecture, pas le manque de widgets.
- Des estimations analystes ou objectifs de cours non sourcés : incompatibles
  avec la promesse actuelle.
- Une expansion internationale superficielle avant un vrai adaptateur IFRS.

## Performance, SEO et sécurité

### Points positifs

- Build de production réussi en environ huit secondes dans cet environnement.
- 921 tests réussis, 1 ignoré ; lint et TypeScript sans erreur.
- `npm audit --omit=dev` : aucune vulnérabilité signalée.
- Aucun warning ni erreur console sur les routes testées.
- Les assets versionnés sont servis avec un cache d'un an et `immutable`.
- La réponse société AAPL fait environ 440 Ko brute et 73 Ko en gzip ; le cache
  d'API annonce une heure avec revalidation en arrière-plan.

### À corriger

1. **HTML revalidé à chaque visite.** La production répond `max-age=0,
   must-revalidate` sur les pages pourtant statiques. Vérifier le routage Sites/
   vinext pour servir réellement les documents statiques depuis l'asset store.
2. **Pas de sitemap.** `/sitemap.xml` répond 404. Générer au minimum les routes
   statiques et une stratégie de découverte pour les sociétés.
3. **Cartes sociales génériques.** Les pages société changent titre et
   description, mais pas les champs Open Graph/X ; un partage AAPL peut donc
   reprendre la carte générique du site.
4. **Pas de manifeste web.** Optionnel aujourd'hui, mais utile si les alertes et
   l'usage mobile deviennent prioritaires.
5. **En-têtes de sécurité incomplets.** Les réponses échantillonnées n'exposent
   pas CSP, `X-Content-Type-Options`, `Referrer-Policy` ni `Permissions-Policy`.
6. **Convention dépréciée.** Le build avertit que `middleware.ts` doit migrer
   vers la convention `proxy`.

## Roadmap recommandée

### Sprint 1 — fondations, 1 à 2 semaines

- Navigation mobile et état actif.
- Contraste, tailles, cibles tactiles et skip link.
- Correction du débordement DCF.
- Dialogues accessibles et recherche annoncée au lecteur d'écran.
- Suppression du faux formulaire de compte.
- Slogan qualifié, couverture visible et disclaimer de recherche.

### Sprint 2 — compréhension, 2 à 3 semaines

- Sous-navigation de la fiche société.
- Résumé décisionnel et « what changed ».
- Timeline avec liens sources.
- États vides pédagogiques.
- Sitemap et métadonnées sociales par société.

### Sprint 3 — rétention, 3 à 5 semaines

- Watchlists multiples.
- DCF partageable.
- Notes de thèse.
- Exports avec provenance.
- Centre d'alertes local.

### Ensuite

- Authentification et synchronisation seulement quand listes, notes, scénarios
  et alertes donnent une raison claire de créer un compte.
- Import portefeuille et lots.
- Assistant sourcé.
- Couverture IFRS et changements de CIK.

## Critères d'acceptation du premier chantier

- Aucun débordement horizontal du document à 390 px ; seuls les tableaux
  explicitement scrollables peuvent dépasser.
- Toutes les destinations sont accessibles en une interaction visible.
- Toutes les actions principales ont une surface tactile d'au moins 44 × 44 px.
- Tout texte informatif atteint un contraste de 4,5:1.
- Aucun texte utile sous 12 px ; texte courant à 14 px ou plus.
- Le clavier permet d'ouvrir, utiliser et fermer recherche et dialogues sans
  perdre le focus.
- La navigation expose la page active.
- Le DCF affiche et permet de choisir tous ses taux sur mobile.
- La fiche société permet d'atteindre chaque section sans long scroll aveugle.
- Tests, lint, typage et build restent verts.

## Ordre de décision conseillé

Si une seule chose doit être faite maintenant : **le chantier mobile +
accessibilité**.

Si trois choses peuvent être faites : ajouter ensuite **le résumé décisionnel
de la fiche société** puis **les scénarios DCF partageables**.

Si l'objectif devient la rétention : construire **watchlists multiples + notes
de thèse + alertes**, puis seulement les comptes et la synchronisation.
