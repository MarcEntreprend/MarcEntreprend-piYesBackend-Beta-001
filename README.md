<div align="center">
<img width="1200" height="475" alt="GHBanner" src="src\assets\images\logo-piyes-ppl-wh-wh-svg.svg" />
</div>

## structure backend

piyes-wallet-backend/
│
├── .env # Variables d'environnement (locales)
├── .env.example # Exemple de variables
├── .gitignore # Fichiers/dossiers ignorés par Git
├── package-lock.json # Versions exactes des dépendances
├── package.json # Dépendances et scripts npm
├── server.ts # Point d'entrée principal Express
├── tsconfig.json # Configuration TypeScript
├── vercel.json # Configuration déploiement Vercel
│
├── server/ # Code source backend
│ └── src/
│ ├── middleware.ts # Middleware (auth, error handler)
│ ├── supabase.ts # Client Supabase
│ │
│ ├── routes/ # Routes API
│ │ ├── auth.ts
│ │ ├── banks.ts
│ │ ├── contacts.ts
│ │ ├── friendship.ts
│ │ ├── promotions.ts
│ │ ├── scheduler.ts
│ │ ├── services.ts
│ │ ├── transactions.ts
│ │ └── user.ts
│ │
│ └── services/ # Services métier backend
│ ├── moncashService.ts
│ └── otpService.ts
│
├── shared/ # Code partagé avec le frontend
│ ├── recipientUtils.ts
│ ├── schemas.ts
│ └── types.ts
│
└── dist/ # Build de production (généré)

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   `npm install`
2. Run the app:
   `npm run dev`

npm install
npm run dev

---

## déployer vercel / # Déployer en production (met à jour le backend Vercel)

cd C:\Users\mmarc\Documents\Programming\myProjects\piYes_projects\piyes-wallet-backend

npm run build
vercel --prod

## Après vercel --prod, VÉRIFIER LE DÉPLOIEMENT

on vera :
✅ Production: https://piyesbackend001-xxxxx.vercel.app
