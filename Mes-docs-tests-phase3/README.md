# Phase 3 — OpenAPI + documentation développeur

Contenu de ce dossier (indépendant des Phases 0/1/4/5) :

| Fichier | Rôle |
|---|---|
| `openapi.yaml` | Spec OpenAPI 3.0.3 complète de `/api/v1` (tous les tags : Auth, User, Transactions, Contacts, Friendship, Scheduler, Services, Promotions, Banks) |
| `server/src/routes/swagger.ts` | Route Express Swagger UI sans dépendance npm (charge swagger-ui-dist depuis CDN) |
| `server.ts.patch.txt` | Patch d'intégration : montage de `/api-docs` dans `server.ts` |
| `DEVELOPER_GUIDE.md` | Guide développeur : auth, conventions, ledger/idempotence, endpoints, realtime, env, limites |

---

## Installation

1. Copier `openapi.yaml` à la racine du repo backend (à côté de `server.ts`)
   **ou** dans `server/src/routes/` — la route Swagger cherche les deux.
2. Copier `server/src/routes/swagger.ts` dans `server/src/routes/`.
3. Ajouter dans `server.ts` (après le montage `/api/v1`) :
   ```ts
   app.use("/api-docs", (await import("./server/src/routes/swagger.js")).default);
   ```
4. Redémarrer : ouvrir `http://192.168.15.2:3000/api-docs`.

## Validation

```bash
npx @redocly/cli lint openapi.yaml
```
Résultat : **valide (0 erreur)** — 136 warnings mineurs (operationId/4xx-response), sans impact.

## Choix techniques

- **Aucune dépendance npm** : Swagger UI chargée depuis le CDN `unpkg` (donc
  besoin réseau pour la *page*, la spec reste servie en local).
  Si vous préférez l'offline, ajouter `swagger-ui-dist` + `serve-static`.
- **Spécifiques piYès documentées** : header `Idempotency-Key`, montants en
  centimes HTG, format d'erreur uniforme `{ error: { message, code } }`.
- **Sécurité** : `bearerAuth` global (JWT), endpoints publics marqués
  `security: []` (signup, login, OTP, verify-session-otp, forgot/reset,
  services/list, promotions, trigger-reminders).
- **Vitrine OBP** : hors spec — elle dispose de sa propre spec officielle
  (`swagger.json` OBP-API v3.1.0) et d'une section dédiée dans le guide.

## Contrat couvert

Tous les routeurs de `server/src/routes/` sont documentés :
`auth.ts` (9 routes), `user.ts` (14), `transactions.ts` (14),
`contacts.ts` (5), `friendship.ts` (4), `scheduler.ts` (9),
`services.ts` (2), `promotions.ts` (1), `banks.ts` (4).
