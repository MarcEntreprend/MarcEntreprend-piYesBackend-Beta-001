# Guide développeur piYès API

Base URL : `http://192.168.15.2:3000/api/v1` (dev) · `https://piyes-backend.vercel.app/api/v1` (prod)
Docs interactives : `GET /api-docs` (Swagger UI)

---

## 1. Authentification

Le flux est en deux temps : **login → (MFA si nouvel appareil) → token JWT**.

### 1.1 Inscription
```
POST /auth/signup
{
  "firstName": "Jean",
  "lastName": "Augustin",
  "email": "jean@exemple.ht",      // email OU phone obligatoire
  "phone": "+50937500101",          // (alternatif)
  "password": "motdepasse123",
  "accountType": "individual"        // ou "business"
}
```
Réponse : `{ "user": {...}, "token": "<JWT>" }`

### 1.2 Connexion
```
POST /auth/login
{ "email": "jean@exemple.ht", "password": "motdepasse123", "device": "iPhone-15" }
```
- **200** : `{ "user": {...}, "token": "<JWT 24h>" }` + cookie `refreshToken` (30 j).
- **200 avec `mfaRequired: true`** : nouvel appareil détecté. Valider ensuite :
  ```
  POST /auth/verify-session-otp
  { "requestId": "<renvoyé par login>", "otpCode": "<6 chiffres>" }
  ```

### 1.3 Envoyer le token
```
Authorization: Bearer <JWT>
```
Toute route protégée renvoie **401** `{ "error": { "code": "UNAUTHORIZED" } }` si
le token manque ou expire.

### 1.4 OTP (mot de passe à usage unique)
- `POST /auth/otp/request` (protégé) — génère un OTP, **5 tentatives max, TTL 15 min**.
- `POST /auth/otp/verify` `{ email, otpCode }`.
- `POST /auth/forgot-password` puis `POST /auth/reset-password` `{ email, otpCode, newPassword }`.

---

## 2. Conventions

### 2.1 Montants
- **Requêtes** : entiers en **centimes HTG** (`amount: 250000` = 2 500,00 HTG).
- **Réponses login/sync** : décimales (`balance: 185250` → `/100` = 1 852,50).
- Toujours **positifs** (`minimum: 0, exclusiveMinimum: true`). Montant négatif → 400.

### 2.2 Format d'erreur
```json
{ "error": { "message": "Texte lisible", "code": "INSUFFICIENT_BALANCE" } }
```
Codes fréquents : `UNAUTHORIZED`, `USER_EXISTS`, `INVALID_CREDENTIALS`,
`WRONG_PASSWORD`, `ACCOUNT_DISABLED`, `INSUFFICIENT_BALANCE`,
`LEDGER_NOT_INITIALIZED`, `NOT_FOUND`.

### 2.3 Idempotence (ledger)
Toutes les routes de mouvement de fonds passent par le ledger en partie double.
- Header optionnel **`Idempotency-Key`** : même clé → même ordre → pas de double
  débit (rejeu renvoyé avec `replay: true`).
- Si le header est absent, une clé est générée automatiquement (UUID).

---

## 3. Mouvements de fonds

| Route | Description | Corps requis |
|---|---|---|
| `POST /transactions/transfer` | P2P vers un contact | `{ amount, contactId, pin }` |
| `POST /transactions/scan` | Paiement QR | `{ data, pin }` |
| `POST /transactions/deposit` | Dépôt | `{ amount, accountId, pin? }` |
| `POST /transactions/withdraw` | Retrait | `{ amount, accountId, pin? }` |
| `POST /transactions/recharge` | Recharge mobile | `{ phoneNumber, amount, operatorId, accountId, pin }` |
| `POST /services/pay` | Paiement service/fournisseur | `{ providerTag, amount, description? }` |
| `POST /transactions/moncash/confirm` | Confirmation MonCash (anti-rejeu) | — (callback) |
| `POST /transactions/inter-bank-transfer` | Virement inter-bancaire (legacy) | `{ sourceId, destId, amount, note?, pin? }` |

Exemple transfert :
```bash
curl -X POST http://192.168.15.2:3000/api/v1/transactions/transfer \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 11111111-1111-4111-8111-111111111111" \
  -d '{"amount": 250000, "contactId": "demo-contact-1", "pin": "1234"}'
```

### Erreurs ledger
- `INSUFFICIENT_BALANCE` (400) — pas assez de fonds (garde par ligne).
- `LEDGER_NOT_INITIALIZED` (500) — `ledger.sql` non exécuté dans Supabase.

---

## 4. Paiements planifiés & demandes

- `POST /transactions/schedule` — créer un paiement planifié
  `{ amount, counterparty, dueDate, type: incoming|outgoing, frequency: once|weekly|monthly }`.
- `GET /scheduler` / `POST /scheduler/create` / `POST /scheduler/confirm` /
  `PATCH /scheduler/{id}/reminders` / `DELETE /scheduler/{id}`.
- `GET /scheduler/by-token/{token}` — lien de paiement partagé.
- `POST /scheduler/trigger-reminders` — **cron interne**, header `x-cron-secret` requis.

---

## 5. Comptes & banques

- `GET /banks/available` — liste des banques (Unibank, MonCash, Sogebank, BNC, ...).
- `POST /banks/link` — lier un compte externe
  `{ bankId, username, password?, credentials? }` (MonCash : pas de password).
- `DELETE /banks/{id}` — **soft delete** (`status=inactive`), le solde est conservé.
- `GET /banks/{id}/transactions` — historique d'un compte lié.

> Sécurité : les credentials ne sont plus stockés en clair (Phase 0). Un compte
> `piYès` principal ne peut pas être délié (403).

---

## 6. Contacts, amitiés, notifications

- `GET /contacts` · `POST /contacts/sync` (annuaire téléphone) · `PATCH /contacts/{id}`.
- `POST /friendship/request` · `POST /friendship/accept` · `DELETE /friendship/cancel` · `GET /friendship/status`.
- Notifications : `POST /user/notifications/mark-read`, réception en **realtime**
  via le canal Supabase `Notification`.

---

## 7. Temps réel (Supabase realtime)

Les clients peuvent s'abonner aux changements :
- Table `User` (solde, profil)
- Table `Transaction` (nouveaux mouvements)
- Table `Contact` · Table `Notification`

Exemple (React) :
```ts
supabase.channel('txns').on('postgres_changes', {
  event: 'INSERT', schema: 'public', table: 'Transaction',
  filter: `userId=eq.${userId}`,
}, (payload) => setTransactions(p => [payload.new, ...p])).subscribe();
```

---

## 8. Vitrine Open Banking (OBP v3.1.0)

Endpoints `/obp/v3.1.0/*` (base : racine de l'hôte, **pas** `/api/v1`) :

- `GET /obp/v3.1.0/banks`
- `GET /obp/v3.1.0/accounts/public`
- `GET /obp/v3.1.0/banks/{bankId}/accounts/{accountId}/{viewId}/transactions`

Deux modes :
- **Proxy** (si `OBP_BASE_URL` défini) : relaye vers une instance OBP réelle
  avec DirectLogin (`OBP_USERNAME`, `OBP_PASSWORD`, `OBP_CONSUMER_KEY`).
- **Local** : mock lecture seule sur les tables Supabase piYès.

Exemple :
```bash
curl http://192.168.15.2:3000/obp/v3.1.0/banks
```

---

## 9. Environnement

| Variable | Requis | Rôle |
|---|---|---|
| `JWT_ACCESS_SECRET` | oui | Signature du JWT d'accès |
| `JWT_REFRESH_SECRET` | oui | Signature du refresh token |
| `CRON_SECRET` | oui | `/scheduler/trigger-reminders` |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | oui | Client Supabase |
| `PORT` | non | Défaut 3000 |
| `OBP_BASE_URL` / `OBP_USERNAME` / `OBP_PASSWORD` / `OBP_CONSUMER_KEY` | non | Vitrine OBP (proxy) |

## 10. Limitations connues

- `/transactions/inter-bank-transfer` reste legacy : il cible des comptes
  externes **hors ledger** (pas de journal en partie double).
- Les erreurs de validation Zod sont renvoyées en 400 avec `error.message`.
- Le refresh token est un cookie httpOnly (natif) ; la révocation est prévue
  en Phase 2.
