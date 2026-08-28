# 📋 Notes d'audit Frontend ↔ Backend — PiYes Wallet

> Document de référence généré après audit complet (lecture seule).
> Cible : démo fonctionnelle pour user-testeurs. Aucune promesse prod.
>
> **Date** : 2026-08-27
> **Périmètre** : backend `piyes-wallet-backend` (Node 22, Express 5, Supabase, MonCash) et frontend `piyes-wallet-frontend` (React 19, Vite, TS, Tailwind, Capacitor).

---

## 1. 🎯 Objectif démo & invariants

Les user-testeurs doivent pouvoir :

| #   | Action                                                              | Statut démo                                                        |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | Sign up (individuel ou business)                                    | ✅ Fonctionne (backend OK)                                         |
| 2   | Login (email OU téléphone + mot de passe)                           | ✅ Fonctionne                                                      |
| 3   | MFA OTP au login (nouvel appareil)                                  | ✅ Fonctionne                                                      |
| 4   | Setup du PIN                                                        | ✅ Fonctionne                                                      |
| 5   | Rester logué entre 2 sessions navigateur                            | ⚠️ **À corriger** (refresh token ignoré → 24h max)                 |
| 6   | Verrouillage auto après inactivité + déverrouillage PIN             | ⚠️ **À harmoniser** (3 essais front vs 5 backend)                  |
| 7   | Voir solde + comptes externes (BUH/MonCash)                         | ✅ Fonctionne (MonCash solde via USSD)                             |
| 8   | Transférer vers un contact piYès (par tag, email, phone, randomKey) | ✅ Fonctionne                                                      |
| 9   | Transférer vers une banque externe (inter-bank)                     | ✅ Fonctionne                                                      |
| 10  | Dépôt (par agent)                                                   | ⚠️ Mock agents (4 hardcodés), mais la transaction marche           |
| 11  | Retrait (code + QR)                                                 | ✅ Fonctionne (sauf annulation — pas de backend)                   |
| 12  | Recharge mobile (Digicel, Natcom)                                   | ✅ Fonctionne                                                      |
| 13  | Demande de paiement (lien/QR avec polling)                          | ✅ Fonctionne (demande = client-side, pas de persistance backend)  |
| 14  | Paiement programmé (scheduler "rappels")                            | ✅ Fonctionne                                                      |
| 15  | Historique transactions                                             | ⚠️ Filtre par contrepartie cassé en silence                        |
| 16  | Notifications (badge, marqueur lu, realtime)                        | ✅ Fonctionne (badge calculé local, realtime Supabase)             |
| 17  | Vérifier un reçu tiers                                              | ❌ Endpoint backend inexistant — **coming soon modal**             |
| 18  | Gérer ses cartes bancaires                                          | ❌ Backend partiel (table existe, pas de routes) — **coming soon** |
| 19  | Marketplace (annonces, chat)                                        | 🟡 100% mock (assumé conscient)                                    |
| 20  | Payer un service tiers (Ed'H, etc.)                                 | ⚠️ Manque `pin` dans le payload                                    |
| 21  | MFA/TOTP double auth                                                | ❌ Backend inexistant — **coming soon modal + compteur**           |
| 22  | International transfer                                              | ✅ Fonctionne (taux hardcodés)                                     |
| 23  | Supprimer son compte                                                | ⚠️ Manque mot de passe dans le payload                             |
| 24  | Logout simple + logout everywhere                                   | ✅ Fonctionne                                                      |

**Promesse démo** : les 11 premières actions + 12-16-22-24 doivent **toutes marcher sans interruption**. Les 17-19-21 sont des "coming soon". Les 20 et 23 sont des bugs mineurs à fix.

---

## 2. 🩻 État des lieux — frontend ↔ backend

### 2.1 Ce qui matche ✅

- `auth/login`, `auth/signup`, `auth/verify-session-otp`
- `auth/forgot-password`, `auth/reset-password` (envoi `{identifier, code, newPassword}` — backend accepte)
- `auth/otp/verify`, `auth/otp/resend`
- `auth/logout-all`
- `user/sync`, `user/profile`, `user/tag`, `user/search`
- `user/pin`, `user/pin/verify`
- `user/avatar`, `user/privacy`
- `user/keys` (+ `/check-tag`, `/:id/verify`, `/:id` DELETE)
- `user/by-phones`
- `user/notifications/mark-read`
- `user/delete` (⚠️ manque `password` côté front)
- `transactions/transfer`, `/recharge`, `/withdraw`, `/scan`
- `transactions/international`, `/inter-bank-transfer`, `/resolve/:key`
- `transactions/receipts/:id` (params `type, role` côté front inutiles)
- `transactions/reports`
- `transactions/request` (endpoint existe, front ne s'en sert pas vraiment)
- `contacts` (GET, PATCH, DELETE), `contacts/sync`
- `friendship/request`, `/accept`, `/cancel`, `/status`
- `scheduler` (toutes les routes, GET, POST /create, PATCH /:id/reminders, POST /:id/regenerate-qr, POST /confirm, GET /by-token/:token, GET /active-between)
- `banks/available`, `/link`, `/:id` (DELETE), `/:id/transactions`
- `services/list`, `/pay` (⚠️ manque `pin` côté front)
- `promotions`

### 2.2 Divergences de payload 🔴

| Méthode front       | Envoyé                               | Attendu par le code backend                 | Action                                                                                                         |
| ------------------- | ------------------------------------ | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `api.requestOtp`    | `{contact, channel}`                 | `{email}` OU `{phone}`                      | **Front** : envoyer `{email}` ou `{phone}` selon le type                                                       |
| `api.getHistory`    | `?counterpartyName=…`                | non lu                                      | **Backend** : ajouter le filtre (2 lignes dans `transactions.ts:1501+`)                                        |
| `api.deposit`       | `{amount, accountId, pin}`           | exige `x-admin-secret` en prod (pour piYès) | **Aucune** : route admin interne, doc README                                                                   |
| `api.payService`    | `{providerTag, amount, description}` | pin runtime requis                          | **Front** : wrap dans `triggerSensitiveAction` (priorité basse, page "Services" non accessible nav principale) |
| `api.deleteAccount` | `{}`                                 | `{password}` requis                         | **Front** : ajouter modal confirmation password dans Profile                                                   |

### 2.3 Endpoints appelés par le front mais INEXISTANTS ❌

| Méthode front          | Endpoint cassé                                  | Page impactée       | Action démo                                                                  |
| ---------------------- | ----------------------------------------------- | ------------------- | ---------------------------------------------------------------------------- |
| `api.enableMfa`        | `POST /user/mfa/enable`                         | Security.tsx (MFA)  | **Coming-soon modal + compteur**                                             |
| `api.disableMfa`       | `POST /user/mfa/disable`                        | Security.tsx        | Idem                                                                         |
| `api.setupTotp`        | `GET /user/mfa/totp/setup`                      | Security.tsx (TOTP) | Idem                                                                         |
| `api.verifyTotp`       | `POST /user/mfa/totp/verify`                    | Security.tsx        | Idem                                                                         |
| `api.cancelWithdrawal` | `POST /transactions/withdraw/:requestId/cancel` | WithdrawFlow.tsx    | **Coming-soon modal + compteur** (bouton "Annuler")                          |
| `api.verifyExternalId` | `GET /transactions/verify/:id`                  | Verification.tsx    | **Coming-soon modal** (rediriger vers `getReceipt` si id ressemblant à UUID) |
| `api.decryptId`        | `POST /utils/decrypt`                           | Advanced.tsx        | **Retrait pur** (page debug, pas user-facing)                                |

### 2.4 Endpoints backend existants non câblés 🟡

| Endpoint                                 | Usage potentiel          | Action démo                                                                  |
| ---------------------------------------- | ------------------------ | ---------------------------------------------------------------------------- |
| `GET /user/qr`                           | QR identité (Settings)   | **Front** : câbler (1 méthode) — plus simple que de générer localement       |
| `POST /transactions/generate-qr`         | QR de paiement           | **Garder local + remplacer `api.qrserver.com` par `qrcode.react`** (privacy) |
| `POST /transactions/scan-qr`             | Alias de `/scan`         | **Rien** (doublon)                                                           |
| `GET /user/notifications/unread-count`   | Compteur dédié           | **Rien** (calcul local marche)                                               |
| `POST /user/notifications/mark-all-read` | Marquer tout lu          | **Rien** (`mark-read {all:true}` suffit)                                     |
| `GET /contacts/suggestions`              | Suggestions utilisateurs | **Rien** (`/user/search` suffit)                                             |
| `POST /contacts/update/:id`              | Variante POST update     | **Rien** (doublon, front utilise PATCH)                                      |
| `GET /transactions/moncash/*`            | MonCash end-user         | **Hors démo** (pas de UI MonCash dans le front)                              |
| `GET /obp/v3.1.0/*`                      | API publique tiers       | **Hors démo** (pas de console dev dans le front)                             |

### 2.5 Mocks silencieux 🟡 (UI marche mais en local)

| Service                                                                       | Mock                                 | Conséquence démo                                 | Action                                                                      |
| ----------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------ | --------------------------------------------------------------------------- |
| `cardService` (tout)                                                          | localStorage (1 carte hardcodée)     | UI cartes fonctionnelle, données fictives        | **Mode démo** : badge "DEMO" visible + bouton "Réessayer" (backend partiel) |
| `api.getAgents`                                                               | 4 agents en dur                      | Liste figée                                      | **Mode démo** : OK, doc README                                              |
| `api.getSessions`                                                             | 2 sessions en dur                    | Mensonge à l'user                                | **Masquer la section Sessions dans Security.tsx**                           |
| `api.getHealth`                                                               | `{status,version,uptime}` en dur     | Faux sur Advanced                                | **Front** : appeler `/api/health` (1 ligne)                                 |
| `externalBankService.getBalance`                                              | `return 0`                           | Pas utilisé (le front lit `sync.accounts`)       | **Rien**                                                                    |
| `financeService`                                                              | calculs purs OK (taux hardcodés)     | International marche                             | **Rien** (note README)                                                      |
| `aiService`                                                                   | DeepSeek direct (clé API côté front) | IA support fonctionne                            | **Mode démo** : OK, note README "à migrer côté backend en prod"             |
| `messagingService`                                                            | 3 conversations in-memory            | Marketplace chat marche                          | **Mode démo** : OK (assumé conscient)                                       |
| `searchService`                                                               | index statique local                 | Recherche globale marche                         | **Mode démo** : OK                                                          |
| `cacheService`                                                                | "chiffrement" Base64                 | Faux chiffrement (audit précédent)               | **Mode démo** : OK, note README                                             |
| `documentService`, `beneficiaryService`, `capitalService`, `receivingService` | mocks                                | Sections correspondantes non accessibles en démo | **Rien**                                                                    |
| `rechargeService.performRecharge`                                             | stub `return request`                | Mort (le vrai flow passe par `api.recharge()`)   | **Supprimer** (code mort)                                                   |
| `schedulerService` (60 lignes)                                                | localStorage only                    | Mort (apiService a ses propres méthodes HTTP)    | **Supprimer** (code mort)                                                   |

### 2.6 Bugs d'affichage identifiés pendant l'audit 🟠

| Fichier                    | Ligne   | Bug                                                                                     | Fix                                                                       |
| -------------------------- | ------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `pages/BankHistory.tsx`    | 435     | `tx.amount.toLocaleString()` au lieu de `displayMoney(tx.amount * 100)` → montants ×100 | Remplacer par `displayMoney(tx.amount * 100)`                             |
| `pages/Plans.tsx`          | 126     | `Array.isArray(perks)` sur retour de `t()` (toujours string) → liste d'avantages vide   | Parser par `\n` ou transformer `t()` pour retourner un array              |
| `pages/AdDetail.tsx`       | 326     | "Contacter" passe `ad.id` à `/chat/:id` → conversation introuvable                      | Créer la conversation via `messagingService.getOrCreate` avant navigate   |
| `pages/Contacts.tsx`       | 1449    | `showToast` throw Error("Function not implemented")                                     | Implémenter ou supprimer le handler (modal import contacts inatteignable) |
| `pages/ForgotPassword.tsx` | 107-111 | `console.log` de la réponse complète du reset (token)                                   | Supprimer le log                                                          |
| `pages/ForgotPassword.tsx` | 260-265 | Badge "Dev mode" permanent                                                              | Conditionner à `import.meta.env.DEV`                                      |
| `pages/Security.tsx`       | 135-151 | `removePin` simulé localement uniquement                                                | Câbler sur `POST /user/pin {pin, currentPin}` du backend                  |

### 2.7 Sécurité & session 🟠

| Point                   | Statut                                                              | Action démo                                                      |
| ----------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Refresh token           | ❌ Ignoré → déconnecté après 24h                                    | **Priorité démo** : implémenter `/auth/refresh` côté front       |
| Lockout PIN             | ⚠️ Front = 3 essais, backend = 5 essais                             | Harmoniser à 5 côté front (sécurité alignée)                     |
| Inactivité 5min         | ✅ Front lock auto, mais lockoutService backend n'est pas déclenché | OK pour démo                                                     |
| Auth-expired handling   | ⚠️ Toast tardif, pas de retry                                       | Connecté à l'item refresh token ci-dessus                        |
| `__loginResolve` global | 🟡 Pattern fragile                                                  | Pas bloquant, à refactor plus tard                               |
| MFA setup modal         | ❌ Endpoint manquant                                                | **Coming-soon + compteur** (cf. 2.3)                             |
| Cards PIN reveal        | 🔴 Pas de PIN avant révélation                                      | **Fix démo** : `triggerSensitiveAction` avant d'afficher PAN/CVV |
| DecryptId               | 🔴 Endpoint debug exposé                                            | **Retrait** (cf. 2.3)                                            |

### 2.8 Types désynchronisés 🟡 (dette technique, non bloquant)

| Type front     | Champs manquants                                                                 | Action                          |
| -------------- | -------------------------------------------------------------------------------- | ------------------------------- |
| `SyncResponse` | `cards, friendships, scheduledPayments, notifications, unreadNotificationsCount` | Compléter (1 fichier, 5 lignes) |
| `Transaction`  | `userId, accountId, moncashReference, payment_order_id`                          | Compléter                       |
| `User`         | `primaryKeys`                                                                    | Compléter                       |

Aucun bug à l'exécution (TS structural typing), mais dette à régler.

---

## 3. 🛠️ Dette technique à régler en parallèle de la démo

| #   | Item                                                                       | Effort | Risque |
| --- | -------------------------------------------------------------------------- | ------ | ------ |
| 1   | `tsconfig.json` — ajouter `"include": [...]`                               | 2 min  | Zéro   |
| 2   | Compléter `shared/types.ts` (cf. 2.8)                                      | 10 min | Zéro   |
| 3   | Nettoyer signature `getReceipt(id)` (suppr params inutiles)                | 5 min  | Zéro   |
| 4   | Nettoyer signature `createPiyesCard(name, isTemp)` (suppr params inutiles) | 5 min  | Zéro   |
| 5   | Supprimer `services/schedulerService.ts` (60 lignes, mort)                 | 2 min  | Zéro   |
| 6   | Supprimer `services/rechargeService.ts:73-77` (`performRecharge` stub)     | 2 min  | Zéro   |
| 7   | Supprimer `apiService.ts:249-251` (`socialLogin` throw)                    | 2 min  | Zéro   |
| 8   | Bug `BankHistory.tsx:435`                                                  | 2 min  | Zéro   |
| 9   | Supprimer `console.log` token dans `ForgotPassword.tsx:107-111`            | 2 min  | Zéro   |
| 10  | Conditionner badge "Dev mode" sur `import.meta.env.DEV`                    | 5 min  | Zéro   |

---

## 4. 💡 Améliorations UX issues de l'audit précédent (rappel)

Issues identifiées dans l'audit interne antérieur, classées par sévérité.

### 🔴 Critiques (bloquent ou trompent l'utilisateur)

- **CardsHub** : révélation du numéro/CVC sans vérification PIN (mock localStorage pour l'instant). Fix : `triggerSensitiveAction` avant d'afficher les données sensibles.
- **Advanced.tsx** : endpoint `/utils/decrypt` exposé sans auth admin. Fix : gated derrière un flag ou supprimer la page.
- **Contacts.tsx** : `showToast` throw Error (ligne 1449) + modal d'import contacts natifs inatteignable (handler mort).
- **Plans.tsx** : perks vides + toast de succès factice (API commentée).
- **AdDetail.tsx** : "Contacter" passe un id d'annonce à `/chat/:id` → conversation introuvable.

### 🟠 Importants (UX dégradée)

- **QR de paiement** : utilise `api.qrserver.com` (fuite de tokens de paiement à un tiers). Fix : remplacer par `qrcode.react` (déjà installé).
- **ForgotPassword.tsx** : badge "Dev mode" permanent, console.log du token dans la réponse.
- **Security.tsx** : suppression du PIN simulée localement uniquement.
- **BankHistory.tsx** : montants affichés via `toLocaleString` au lieu de `displayMoney(amount*100)`.
- **MarketplaceSearch** : `?category=` ignoré, filtres non reliés.
- **ServicesMarket** : modal "Publier une annonce" non fonctionnelle.

### 🟡 Mineurs (qualité de code)

- **Pages orphelines** : `/feedback`, `/privacy` sans point d'entrée.
- **HelpCenter** : champ de recherche ne filtre rien.
- **Support** : 3 cartes sans handler.
- **Translation incomplète** : ContactDetail, Feedback, InternationalProviders en français codé en dur.
- **`tab` perdu** en route vers `/services` via la recherche globale.
- **marketplace tab badges** codés en dur.
- **Composants inutilisés** : AnimatePresence, motion, displayMoney (selon pages).

---

## 5. 🚧 Fonctionnalités en mode démo (backend partiel ou mocks)

Les fonctionnalités ci-dessous fonctionnent en UI mais reposent sur des mocks locaux
ou des endpoints backend partiels. À remplacer par les vrais endpoints quand le
backend les supportera.

- **Cartes bancaires** (CardsHub) — CRUD local (`localStorage["piyes_cards"]`).
  Le backend a la table `Card` mais aucune route `/cards` n'est montée. Le
  PAN/CVV révélé est **aléatoire**, jamais stocké en BDD.
- **Liste d'agents de dépôt/retrait** (DepositFlow, WithdrawFlow) — 4 agents
  hardcodés dans `apiService.getAgents()`. Pas d'endpoint backend.
- **Sessions actives** (Security) — section **masquée** dans la démo tant que
  pas d'endpoint backend. Les 2 sessions hardcodées de `getSessions()` ne sont
  jamais affichées.
- **Santé backend** (Advanced) — section "Backend health" branchée sur
  `/api/health` après fix ; en attendant, objet statique dans `getHealth()`.
- **IA support** (AiSupportChat) — appel direct à l'API DeepSeek depuis
  le frontend (clé API exposée via `VITE_DEEPSEEK_API_KEY`). À migrer
  côté backend pour la prod.
- **Marketplace** (ServicesMarket, AdDetail, ChatDetail, MessagingHub) —
  100% mock mémoire (`messagingService.ts`). Tables `Ad`, `Conversation`,
  `Message` existent en BDD mais aucune route `/marketplace/*` n'est montée.
- **Outils financiers** (FinancialTools) — taux de change internationaux
  hardcodés dans `financeService.ts` (US=132, CA=96, FR=141, DO=2.2, BR=26, CL=0.14).
- **Documents fiscaux** (documentService), bénéficiaires (beneficiaryService),
  capital (capitalService), receiving (receivingService) — 100% mocks.
  Pas d'endpoint backend prévu à court terme.
- **Recherche utilisateurs (variante suggestions)** — le front utilise
  `GET /user/search`. Le backend a aussi `GET /contacts/suggestions`
  (doublon non utilisé).
- **Mise à jour contact (variante POST)** — le front utilise
  `PATCH /contacts/:id`. Le backend a aussi `POST /user/contact-update/:id`
  (doublon non utilisé).
- **Demande de paiement** (RequestPayment) — la "demande" est gérée
  côté client (lien public + polling de balance), **pas de persistance
  serveur**. La table `Notification` est notifiée via `notifications`.
- **Recherche de reçu tiers** (Verification) — endpoint backend inexistant
  en démo. Coming-soon modal.
- **MFA / TOTP** (Security) — endpoints backend inexistants. Coming-soon
  modal + compteur de clics pour les stats.
- **Annulation de retrait** (WithdrawFlow) — endpoint backend inexistant.
  Coming-soon modal + compteur de clics.

---

## 6. 🔐 Note de sécurité à l'attention des user-testeurs

Cette application est une **démo**. Plusieurs mécanismes de sécurité sont
intentionnellement simplifiés ou absents pour faciliter les tests :

- **"Chiffrement" du cache local** : `cacheService.ts` utilise Base64 (pas AES).
  Aucune donnée sensible réelle n'est protégée au repos.
- **Clé API DeepSeek exposée** : `VITE_DEEPSEEK_API_KEY` est dans le bundle
  front. Tout le monde peut l'extraire. OK pour démo, **inacceptable en prod**.
- **PIN** : 4 chiffres, sans rate-limit côté front. Le backend applique
  5 essais → lockout 15 min. En démo, on harmonise le front à 5 essais.
- **Cartes** : PAN/CVV révélés sont **aléatoires** (mock). Aucun risque,
  mais aucun réalisme.
- **Dépôt piYès** : nécessite `x-admin-secret` en production. La démo
  utilise des comptes pré-rechargés par l'admin.
- **QR de paiement** : avant fix, générés via `api.qrserver.com` (fuite
  de tokens). **À remplacer par `qrcode.react`** avant démo user-testeurs.

---

## 7. 📊 Métriques / stats user-testeurs

Pour le suivi des fonctionnalités "coming soon", un compteur local
incrémente à chaque clic sur les boutons modalisés. Clés localStorage :

- `piyes-coming-soon-clicks` (objet `{feature: count}`)

Features trackées :

- `mfa` (bouton "Activer la double authentification" dans Security)
- `totp` (bouton "Configurer TOTP" dans Security)
- `cancel-withdrawal` (bouton "Annuler" dans WithdrawFlow)
- `verify-receipt` (bouton "Vérifier un reçu" dans Verification)

À lire depuis la console dev ou via un script d'extraction post-démo.

---

# 📋 Hors-périmètre (dette non bloquante démo)

## Liste

- Tests frontend automatisés (équivalent des 72 tests backend) : chantier à part.
- OBP console dev/admin : pas de UI dans le front.
- MonCash end-user flow : pas de UI dans le front.
- i18n complet (ht/en pour toutes les pages) : déjà partiel, on complète après.
- Refactor du pattern `window.__loginResolve` : pas bloquant.
- Refonte de `cacheService` chiffrement (Base64 → AES) : pas pour la démo.
- KYC réel (Persona SDK) : pas pour la démo.
- CI/CD : pas demandé.
- Doublons backend (`/user/contact-update/:id`, `/contacts/suggestions`, etc.) : nettoyage à faire côté backend, pas bloquant.
- Refonte du marketplace pour utiliser le BDD : chantier à part, 2-3 jours.
- Migration DeepSeek côté backend : chantier sécurité, à part.
- i18n codé en dur (ContactDetail, Feedback, etc.) : à passer par `t()` après la démo.
- `/feedback` et `/privacy` orphelins : à câbler ou masquer dans la nav.

## Note d'analyse : ce que j'ai raté dans l'audit précédent

- `useSync.ts:9` lit le cache au mount (offline-first déjà bien fait) → non documenté.
- `lockoutService.ts` du backend : 5 essais, 15min --- divergence avec les 3 du front.
- `pinService.ts` du backend : simple `bcrypt.compare` → pas de nuance, OK.
- `cacheService.clearSensitiveData` vs `clearAll` : à vérifier qu'on appelle la bonne au logout. D'après le code, `clearSensitiveData` vide aussi les `piyes_vault_*` via `clearAll()` (ligne 84-90, 92-93). → OK, pas un bug.
- Le `useSync` polling 60s est documenté mais je n'avais pas noté qu'il y a aussi un `error` state mis à "Erreur de synchronisation" si le sync fail --- mais le cache est préservé (ligne 35-38), donc bonne UX offline.
- Le MFA est déjà géré correctement côté backend (lockout 5 essais via `otpLimiter`, rotation des sessions). Donc le front qui n'a pas MFA est moins grave --- la vraie sécurité est côté serveur. À nuancer dans le README.
- L'inter-bank transfer est aussi dépendant de `MONCASH_*` env vars. Si non configuré, la route renvoie 500. Pour la démo avec BUH/MonCash, c'est documenté backend.
- Boutique/payService : la page "Services" n'est pas accessible depuis la nav principale (BottomNav a 3 items seulement). Donc fix non urgent.

---
