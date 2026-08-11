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

| Route                                    | Description                         | Corps requis                                          |
| ---------------------------------------- | ----------------------------------- | ----------------------------------------------------- |
| `POST /transactions/transfer`            | P2P vers un contact                 | `{ amount, contactId, pin }`                          |
| `POST /transactions/scan`                | Paiement QR                         | `{ data, pin }`                                       |
| `POST /transactions/generate-qr`         | Générer un QR de paiement (Phase 2) | `{ amount?, description?, expiresInMinutes? }`        |
| `POST /transactions/scan-qr`             | Payer via QR (alias scan, Phase 2)  | `{ qrData, pin, amount? }`                            |
| `POST /transactions/deposit`             | Dépôt                               | `{ amount, accountId, pin? }`                         |
| `POST /transactions/withdraw`            | Retrait                             | `{ amount, accountId, pin? }`                         |
| `POST /transactions/recharge`            | Recharge mobile                     | `{ phoneNumber, amount, operatorId, accountId, pin }` |
| `POST /services/pay`                     | Paiement service/fournisseur        | `{ providerTag, amount, description? }`               |
| `POST /transactions/moncash/confirm`     | Confirmation MonCash (anti-rejeu)   | — (callback)                                          |
| `POST /transactions/inter-bank-transfer` | Virement inter-bancaire (legacy)    | `{ sourceId, destId, amount, note?, pin? }`           |

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
- **Phase 2 — P2P** : `GET /contacts/suggestions` (utilisateurs piYès à
  découvrir, filtre `?q=` et `?limit=`) · `POST /transactions/generate-qr`
  (QR de paiement avec montant optionnel) · `POST /transactions/scan-qr`
  (payer en scannant, alias de `/transactions/scan`).
- `POST /friendship/request` · `POST /friendship/accept` · `DELETE /friendship/cancel` · `GET /friendship/status`.
- Notifications : `POST /user/notifications/mark-read` · **Phase 2 — P2P** :
  `POST /user/notifications/mark-all-read` et
  `GET /user/notifications/unread-count`. Réception en **realtime** via le
  canal Supabase `Notification`.

---

## 7. Temps réel (Supabase realtime)

Les clients peuvent s'abonner aux changements :

- Table `User` (solde, profil)
- Table `Transaction` (nouveaux mouvements)
- Table `Contact` · Table `Notification`

Exemple (React) :

```ts
supabase
  .channel("txns")
  .on(
    "postgres_changes",
    {
      event: "INSERT",
      schema: "public",
      table: "Transaction",
      filter: `userId=eq.${userId}`,
    },
    (payload) => setTransactions((p) => [payload.new, ...p]),
  )
  .subscribe();
```

---

## 8. API publique Open Banking (OBP v3.1.0) — Phase 4

### 8.1 Clés API des tiers

Les endpoints OBP sont protégés par **clé API**. Créer une clé (JWT admin) :

```bash
curl -X POST http://localhost:3000/obp/v3.1.0/keys \
  -H "Authorization: Bearer <jwt>" -H "Content-Type: application/json" \
  -d '{"name":"Partenaire Beta"}'
# → { apiKey: "piyes_...", id, name, status }
```

La clé brute n'est affichée **qu'une seule fois** (seul son hash SHA-256 est
stocké en base, table `piyes_api_key` créée par `obp-api-keys.sql`).

- `GET /obp/v3.1.0/keys` — lister ses clés (jamais les hashes).
- `DELETE /obp/v3.1.0/keys/{id}` — révoquer une clé.

Utilisation par le tiers (deux formes équivalentes) :

```bash
curl http://localhost:3000/obp/v3.1.0/banks -H "X-API-Key: piyes_..."
curl http://localhost:3000/obp/v3.1.0/banks -H "Authorization: Bearer piyes_..."
```

### 8.2 Endpoints OBP v3.1.0

Endpoints `/obp/v3.1.0/*` (base : racine de l'hôte, **pas** `/api/v1`) :

- `GET /obp/v3.1.0/banks`
- `GET /obp/v3.1.0/accounts/public`
- `GET /obp/v3.1.0/banks/{bankId}/accounts/{accountId}/{viewId}/transactions`

Deux modes :

- **Proxy** (si `OBP_BASE_URL` défini) : relaye vers une instance OBP réelle
  avec DirectLogin (`OBP_USERNAME`, `OBP_PASSWORD`, `OBP_CONSUMER_KEY`).
- **Local** : mock lecture seule sur les tables Supabase piYès
  (`Account`, `Transaction`). Rôles `PAYER`/`RECEIVER`, montants en centimes
  divisés par 100.

Exemple :

```bash
curl http://192.168.15.2:3000/obp/v3.1.0/banks -H "X-API-Key: piyes_..."
```

---

## 9. Environnement

| Variable                                                              | Requis | Rôle                           |
| --------------------------------------------------------------------- | ------ | ------------------------------ |
| `JWT_ACCESS_SECRET`                                                   | oui    | Signature du JWT d'accès       |
| `JWT_REFRESH_SECRET`                                                  | oui    | Signature du refresh token     |
| `CRON_SECRET`                                                         | oui    | `/scheduler/trigger-reminders` |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY`                                  | oui    | Client Supabase                |
| `PORT`                                                                | non    | Défaut 3000                    |
| `OBP_BASE_URL` / `OBP_USERNAME` / `OBP_PASSWORD` / `OBP_CONSUMER_KEY` | non    | API publique OBP (mode proxy)  |
| `RATE_LIMIT_GLOBAL` / `AUTH` / `OTP` / `PIN` / `FUNDS` / `APIKEY`     | non    | Seuils de rate limiting        |
| `RESEND_API_KEY` / `OTP_FROM_EMAIL`                                   | non    | Envoi OTP par email            |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM`            | non    | Envoi OTP par SMS              |

## 10. Sécurité (Phase 6)

- **Rate limiting** (`express-rate-limit`) : limite globale sur `/api/v1`
  (120 req/min), limites strictes sur `/auth/login`, `/auth/otp/*`,
  `/auth/forgot-password`, `/auth/reset-password`, `/user/pin/verify`,
  `/transactions/*` et `/obp/v3.1.0/keys`. Réponse `429 TOO_MANY_REQUESTS`.
- **Headers de sécurité** : `helmet` (CSP autorisant `unpkg.com` pour Swagger UI,
  HSTS, nosniff, frame-ancestors, etc.).
- **OTP persisté** : les codes sont stockés **hachés** (SHA-256) dans la table
  `otp_challenge` (jamais en clair), consommés une seule fois, limités à
  5 tentatives, valables 15 min. Livraison : **Resend** (email) ou **Twilio**
  (SMS `+509`), avec fallback log console en dev.
- **Sessions & refresh tokens** :
  - `POST /auth/refresh` : rotation du refresh token (cookie httpOnly),
    ancien token remplacé en base. Un token réutilisé (rejeu) purge toutes
    les sessions de l'utilisateur.
  - `authMiddleware` vérifie la **session en base** (`isVerified`, non
    expirée) à chaque requête → un `logout-all` révoque immédiatement les
    access tokens.
  - JWT signés avec `issuer`/`audience`/`jti` explicites.
- **errorHandler** centralisé : les erreurs 500 n'exposent jamais le stack en
  production.

## 11. Limitations connues

- `/transactions/inter-bank-transfer` reste legacy : il cible des comptes
  externes **hors ledger** (pas de journal en partie double).
- Les erreurs de validation Zod sont renvoyées en 400 avec `error.message`.
- Les endpoints OBP en mode local servent une **vue lecture seule** de démo :
  ils ne sont jamais source de vérité (le ledger reste la référence).
- La validation de la clé API se fait par hash SHA-256 : un vol de la table
  `piyes_api_key` ne permet pas de réutiliser les clés.
- Le SMS OTP (Twilio) ne peut être livré qu'à des numéros réels ; sans
  `TWILIO_*`, les codes sont affichés en console (dév).

## 12. Tests automatisés

Suite d'intégration basée sur `node:test` + `tsx` (zéro dépendance
supplémentaire) : chaque fichier démarre un **vrai serveur** en
sous-processus (port dédié) et joue les flux via HTTP contre la vraie base.

```bash
npm test
```

- `server/test/helpers.ts` — `startServer({ port })` (attend `[READY]`,
  capture les codes OTP de la console), `makeClient()` (cookie jar pour le
  refresh token), `signup()`, `uniqueEmail()`/`uniquePhone()`, `stop()`.
- `auth.test.ts` (7) — signup, login, MFA 2e device + OTP, refresh
  (rotation + rejeu → purge), logout-all.
- `security.test.ts` (5) — headers helmet, route debug supprimée, rate
  limit (429), OTP mono-usage.
- `obp.test.ts` (7) — clés API, endpoints publics OBP, révocation.
- `transactions.test.ts` (5) — transfert, idempotence, solde insuffisant,
  mauvais PIN, historique.

Note : les tests utilisent l'OTP **console** (pas de Resend/Twilio
configurés) et seedent le ledger directement via service role pour les
transferts. Chaque run pollue la base (`*.@piyes.app` + `payment_order`) ;
un cleanup SQL peut être exécuté entre deux runs.
