<div align="center">
<img width="800" height="317" alt="GHBanner" src="src/assets/images/logo-piyes-ppl-wh-wh-svg.svg" />
</div>

# piYes Wallet Backend

Production-grade Node.js / TypeScript backend for the piYes wallet.  
Supports P2P payments, QR flows, contacts, notifications, and an Open Banking (OBP) public API façade.

---

## Project Structure

```

piyes-wallet-backend/
├── .vercel/
├── docs/
│ └── DEVELOPER_GUIDE.md
├── Mes-docs-tests-phase1/
│ ├── Comment utiliser ces scripts.md
│ ├── supabase-phase1-tests.sql
│ └── test-phase1.ps1
├── Mes-docs-tests-phase3/
│ ├── DEVELOPER_GUIDE.md
│ ├── README.md
│ └── server.ts.patch.txt
├── node_modules/
├── server/
│ └── src/
│ ├── middleware/
│ │ └── rateLimit.ts
│ ├── routes/
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
│ ├── services/
│ │ ├── apiKeyService.ts
│ │ ├── feeTransaction.ts
│ │ ├── ledgerService.ts
│ │ ├── moncashService.ts
│ │ ├── otpDeliveryService.ts
│ │ ├── otpService.ts
│ │ └── pinService.ts
│ ├── middleware.ts
│ └── supabase.ts
├── shared/
│ ├── phoneFormatter.ts
│ ├── recipientUtils.ts
│ ├── schemas.ts
│ └── types.ts
├── src/
│ └── assets/
│ └── images/
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
├── test-security.ps1
├── tsconfig.json
└── vercel.json

```

---

## Phases 2 & 4 Integration

> **Branch**: `phase-1` → `phase-1to5`
> Phases 0, 1, 3, and 5 were already complete.
> This branch adds **Phase 2 (P2P)** and **Phase 4 (Public Open Banking API)**.

**Swagger UI**: [http://localhost:3000/api-docs](http://localhost:3000/api-docs)

### Phase 2 — P2P (QR, Advanced Contacts, Notifications)

| Endpoint                                   | Method | Description                                                              |
| ------------------------------------------ | ------ | ------------------------------------------------------------------------ |
| `/api/v1/transactions/generate-qr`         | POST   | Generate a payment QR (`amount?`, `description?`, `expiresInMinutes?`)   |
| `/api/v1/transactions/scan-qr`             | POST   | Pay via scanned QR (alias of `/transactions/scan`, ledger + idempotency) |
| `/api/v1/contacts/suggestions`             | GET    | User suggestions (`?q=`, `?limit=`)                                      |
| `/api/v1/user/notifications/mark-all-read` | POST   | Mark all notifications as read                                           |
| `/api/v1/user/notifications/unread-count`  | GET    | Unread notification count                                                |

### Phase 4 — Public Open Banking API (OBP v3.1.0)

- **Third-party API keys**: table `piyes_api_key` (see `obp-api-keys.sql`).
  Only the SHA-256 hash of the key is stored.
  - `POST /obp/v3.1.0/keys` (JWT admin) → creates a key (shown once)
  - `GET /obp/v3.1.0/keys`
  - `DELETE /obp/v3.1.0/keys/{id}`

- **Protected OBP endpoints** (require `X-API-Key` or `Bearer`):
  - `GET /obp/v3.1.0/banks`
  - `GET /obp/v3.1.0/accounts/public`
  - `GET /obp/v3.1.0/banks/{bankId}/accounts/{accountId}/{viewId}/transactions`

- **Two modes**:
  - **Proxy** → real OBP instance (when `OBP_BASE_URL` is set, uses DirectLogin)
  - **Mock** → read-only against Supabase (local development)

### Files Added / Modified

| File                                   | Change                                                      |
| -------------------------------------- | ----------------------------------------------------------- |
| `server/src/routes/transactions.ts`    | `generate-qr`, `scan-qr`                                    |
| `server/src/routes/contacts.ts`        | `GET /suggestions`                                          |
| `server/src/routes/user.ts`            | `notifications/mark-all-read`, `notifications/unread-count` |
| `server/src/routes/obpFacade.ts`       | **New** — OBP v3.1.0 façade (proxy / mock)                  |
| `server/src/routes/obpKeys.ts`         | **New** — Third-party API key management                    |
| `server/src/services/apiKeyService.ts` | **New** — Hash / validation / middleware for API keys       |
| `obp-api-keys.sql`                     | **New** — Idempotent `piyes_api_key` table                  |
| `server.ts`                            | Mounts `/obp`                                               |
| `openapi.yaml`                         | P2P + OBP endpoints documented                              |
| `docs/DEVELOPER_GUIDE.md`              | Sections 6 & 8 updated                                      |

---

## Getting Started

### Prerequisites

- Node.js

### Installation

```bash
npm install
```

1. Run `obp-api-keys.sql` in the Supabase SQL Editor.
2. Start the development server:
   ```bash
   npm run dev
   ```
3. Type-check (must report 0 errors):
   ```bash
   npx tsc --noEmit
   ```

### Create an API Key & Call OBP Endpoints

```bash
# Create a key (admin JWT required)
curl -X POST http://localhost:3000/obp/v3.1.0/keys \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Demo"}'

# Call a protected endpoint
curl http://localhost:3000/obp/v3.1.0/banks \
  -H "X-API-Key: <apiKey>"
```

---

## Local Development

### TypeScript / TSX Error Check

```bash
npx tsc --noEmit
```

Or with a PowerShell helper:

```powershell
Write-Host "Vérification des erreurs TypeScript..." -ForegroundColor Cyan
npx tsc --noEmit

if ($LASTEXITCODE -eq 0) {
  Write-Host "✓ AUCUNE ERREUR !" -ForegroundColor Green
} else {
  Write-Host "✗ Des erreurs ont été trouvées" -ForegroundColor Red
}
```

### Quick Start (Windows)

```powershell
cd C:\Users\mmarc\Documents\Programming\myProjects\piYes_projects\piyes-wallet-backend
npm install
npm run dev
```

### Restart the Server

```bash
# Stop the running process (Ctrl+C), then:
npx tsx server.ts
```

**Swagger UI**: [http://localhost:3000/api-docs](http://localhost:3000/api-docs)

### Clear Vite Cache

```powershell
Remove-Item -Recurse -Force node_modules/.vite -ErrorAction SilentlyContinue
```

---

## Deployment (Vercel)

```powershell
cd C:\Users\mmarc\Documents\Programming\myProjects\piYes_projects\piyes-wallet-backend

npm install
npm run build
vercel --prod
```

After a successful production deploy you should see:

```
Production: https://piyesbackend001-xxxxx.vercel.app
```

You can then continue local development with:

```bash
npm run dev
```
