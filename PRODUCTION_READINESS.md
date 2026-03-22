# Production Readiness - Backend

## Checklist P0

- [x] Validation stricte des payloads sensibles (auth/profile)
- [x] Rate limiting global API + rate limiting auth
- [x] CORS whitelist + Helmet
- [x] Gestion d'erreurs globale + 404 JSON
- [x] Arret propre du serveur et deconnexion Prisma
- [x] Lint, typecheck, tests, build via CI

## Commandes locales

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run check`

## Variables d'environnement critiques

- `DATABASE_URL`
- `JWT_SECRET` (>= 32 caracteres)
- `SESSION_STORE_SECRET` (>= 32 caracteres)
- `CORS_ALLOWED_ORIGINS`
- `API_RATE_LIMIT_MAX`
- `API_RATE_LIMIT_WINDOW_MS`
