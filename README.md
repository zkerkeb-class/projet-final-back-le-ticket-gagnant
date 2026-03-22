# Le Ticket Gagnant - Backend

API Express + Prisma du projet academique "Le Ticket Gagnant".

## Perimetre

Ce depot contient:

- l'authentification utilisateur
- la gestion du profil
- les endpoints des jeux
- la persistence Prisma/PostgreSQL
- quelques etats de parties persistes localement en developpement

Le front principal du workspace se trouve dans le depot voisin:

- `../projet-final-front-le-ticket-gagnant`

## Prerequis

- Node.js 20+ recommande
- npm
- PostgreSQL

## Installation

1. Installer les dependances:

```bash
npm install
```

2. Creer le fichier d'environnement:

```bash
copy .env.example .env
```

3. Configurer au minimum:

- `DATABASE_URL`
- `JWT_SECRET`
- `SESSION_STORE_SECRET`
- `CORS_ALLOWED_ORIGINS`

## Base de donnees

Generer le client Prisma puis appliquer les migrations sur la base locale:

```bash
npm run prisma:generate
npm run prisma:migrate
```

Si besoin, peupler la base:

```bash
npx prisma db seed
```

## Lancement

```bash
npm run dev
```

Le serveur demarre par defaut sur `http://localhost:3000`.

## Verification qualite

Avant rendu, les commandes suivantes doivent passer:

```bash
npm run check
```

ou detail:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

## Notes de rendu academique

- `.env` est ignore et ne doit pas etre livre avec des secrets reels.
- `data/sessions/` contient des etats de runtime et ne doit pas polluer le depot.
- Le projet est prevu pour fonctionner avec le front Expo du workspace voisin.
