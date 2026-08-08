<div align="center">
<img width="1200" height="475" alt="GHBanner" src="src\assets\images\logo-piyes-ppl-wh-wh-svg.svg" />
</div>

## structure backend

```
piyes-wallet-backend/
.
├── .vercel
├── docs
├── Mes-docs-tests-phase1
├── Mes-docs-tests-phase3
├── node_modules
├── server
│ └── src
│ ├── routes
│ │ ├── auth.ts
│ │ ├── banks.ts
│ │ ├── contacts.ts
│ │ ├── friendship.ts
│ │ ├── obpFacade.ts
│ │ ├── obpKeys.ts
│ │ ├── promotions.ts
│ │ ├── scheduler.ts
│ │ ├── services.ts
│ │ ├── swagger.ts
│ │ ├── transactions.ts
│ │ └── user.ts
│ ├── services
│ │ ├── apiKeyService.ts
│ │ ├── feeTransaction.ts
│ │ ├── ledgerService.ts
│ │ ├── moncashService.ts
│ │ ├── otpService.ts
│ │ └── pinService.ts
│ ├── middleware.ts
│ └── supabase.ts
├── shared
│ ├── phoneFormatter.ts
│ ├── recipientUtils.ts
│ ├── schemas.ts
│ └── types.ts
├── src
│ └── assets
│ └── images
│ └── logo-piyes-ppl-wh-wh-svg.svg
├── .env
├── .env.example
├── .gitignore
├── notes.txt
├── obp-api-keys.sql
├── openapi.yaml
├── package-lock.json
├── package.json
├── README.md
├── server.ts
├── tsconfig.json
└── vercel.json
```

---

## Phases 2 et 4 intégrées (branche phase-1 → phase-1to5)

> Branch clonée : `phase-1` (Phases 0, 1, 3, 5 déjà terminées).
> Ajoutées ici : **Phase 2 (P2P)** et **Phase 4 (API publique Open Banking)**.

Swagger UI : http://localhost:3000/api-docs

### Phase 2 — P2P (QR, contacts avancés, notifications)

| Endpoint                                   | Méthode | Rôle                                                                       |
| ------------------------------------------ | ------- | -------------------------------------------------------------------------- |
| `/api/v1/transactions/generate-qr`         | POST    | Générer un QR de paiement (`amount?`, `description?`, `expiresInMinutes?`) |
| `/api/v1/transactions/scan-qr`             | POST    | Payer via QR scanné (alias de `/transactions/scan`, ledger + idempotence)  |
| `/api/v1/contacts/suggestions`             | GET     | Suggestions d'utilisateurs piYès (`?q=`, `?limit=`)                        |
| `/api/v1/user/notifications/mark-all-read` | POST    | Marquer toutes les notifications comme lues                                |
| `/api/v1/user/notifications/unread-count`  | GET     | Nombre de notifications non lues                                           |

### Phase 4 — API publique Open Banking (OBP v3.1.0)

- **Clés API tiers** : table `piyes_api_key` (SQL : `obp-api-keys.sql`).
  Seul le hash SHA-256 de la clé est stocké.
  - `POST /obp/v3.1.0/keys` (JWT admin) → crée une clé (affichée une seule fois)
  - `GET /obp/v3.1.0/keys` · `DELETE /obp/v3.1.0/keys/{id}`
- **Endpoints OBP** protégés par clé API (`X-API-Key` ou `Bearer`) :
  - `GET /obp/v3.1.0/banks`
  - `GET /obp/v3.1.0/accounts/public`
  - `GET /obp/v3.1.0/banks/{bankId}/accounts/{accountId}/{viewId}/transactions`
- Deux modes : **proxy** vers une instance OBP réelle (si `OBP_BASE_URL`
  défini, DirectLogin) ou **mock lecture seule** sur Supabase (mode local).

### Fichiers ajoutés/modifiés

| Fichier                                | Changement                                                  |
| -------------------------------------- | ----------------------------------------------------------- |
| `server/src/routes/transactions.ts`    | `generate-qr`, `scan-qr`                                    |
| `server/src/routes/contacts.ts`        | `GET /suggestions`                                          |
| `server/src/routes/user.ts`            | `notifications/mark-all-read`, `notifications/unread-count` |
| `server/src/routes/obpFacade.ts`       | **nouveau** : façade OBP v3.1.0 (proxy/mock)                |
| `server/src/routes/obpKeys.ts`         | **nouveau** : gestion des clés API tiers                    |
| `server/src/services/apiKeyService.ts` | **nouveau** : hash/validation/middleware clés               |
| `obp-api-keys.sql`                     | **nouveau** : table `piyes_api_key` (idempotent, validé)    |
| `server.ts`                            | montage `/obp`                                              |
| `openapi.yaml`                         | endpoints P2P + OBP documentés                              |
| `docs/DEVELOPER_GUIDE.md`              | sections 6 et 8 mises à jour                                |

### Installation

1. `npm install`
2. Exécuter `obp-api-keys.sql` dans le SQL Editor Supabase.
3. `npm run dev` — vérifier `npx tsc --noEmit` (0 erreur).
4. Créer une clé API et appeler les endpoints OBP :
   ```bash
   curl -X POST http://localhost:3000/obp/v3.1.0/keys \
     -H "Authorization: Bearer <JWT>" -H "Content-Type: application/json" \
     -d '{"name":"Demo"}'
   curl http://localhost:3000/obp/v3.1.0/banks -H "X-API-Key: <apiKey>"
   ```

## Run Locally

### Script pour vérifier les erreurs TS/TSX

npx tsc --noEmit

or

```
   Write-Host "Vérification des erreurs TypeScript..." -ForegroundColor Cyan
   npx tsc --noEmit

   if ($LASTEXITCODE -eq 0) {
   Write-Host "✓ AUCUNE ERREUR !" -ForegroundColor Green
   } else {
   Write-Host "✗ Des erreurs ont été trouvées" -ForegroundColor Red
   }
```

**Prerequisites:** Node.js

1. Install dependencies:
   `npm install`
2. Run the app:
   `npm run dev`

cd C:\Users\mmarc\Documents\Programming\myProjects\piYes_projects\piyes-wallet-backend
npm install
npm run dev

---

# Arrêter le serveur en cours (Ctrl+C dans le terminal où il tourne)

# Puis relancer :

npx tsx server.ts

---

## effacer le cache

Remove-Item -Recurse -Force node_modules/.vite -ErrorAction SilentlyContinue

---

## déployer vercel / # Déployer en production (met à jour le backend Vercel)

cd C:\Users\mmarc\Documents\Programming\myProjects\piYes_projects\piyes-wallet-backend

npm install
npm run build
vercel --prod
npm run dev

## Après vercel --prod, VÉRIFIER LE DÉPLOIEMENT

on vera :
✅ Production: https://piyesbackend001-xxxxx.vercel.app
