# Publier FinScope depuis ce dossier

Ce dossier contient le site complet, les fonctions API, le QS Screener, les
tests, les assets et la configuration de production. Les dépendances générées,
les caches, les builds locaux et les fichiers secrets ne sont pas inclus.

## 1. Créer le dépôt GitHub

Crée un dépôt GitHub vide, puis exécute depuis ce dossier :

```bash
git init
git branch -M main
git add .
git commit -m "Initial FinScope import"
git remote add origin https://github.com/VOTRE-COMPTE/VOTRE-DEPOT.git
git push -u origin main
```

## 2. Configurer l'environnement

Copie `.env.example` vers `.env.local` uniquement pour le développement
local. Ne publie jamais `.env.local`.

La variable recommandée est :

```text
SEC_USER_AGENT=FinScope votre-email@example.com
```

Ajoute cette variable directement dans les réglages du service d'hébergement.

## 3. Vérifier localement

```bash
npm ci
npm test
npm run build
npm run dev
```

## 4. Héberger

GitHub conserve le code source, mais GitHub Pages ne peut pas exécuter cette
application : FinScope utilise des fonctions serveur pour SEC EDGAR et Yahoo
Finance.

Connecte plutôt le dépôt GitHub à un hébergeur compatible avec les Workers
Cloudflare/Vinext, puis utilise :

- version de Node.js : 22.13 ou plus récente ;
- commande d'installation : `npm ci` ;
- commande de build : `npm run build` ;
- variable serveur : `SEC_USER_AGENT`.

Le fichier `.openai/hosting.json` permet également de republier le projet avec
Codex Sites.
