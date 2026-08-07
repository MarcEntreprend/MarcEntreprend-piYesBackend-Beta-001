## Comment utiliser ces scripts

```powershell
  # 1. Sauvegarder le script PowerShell dans le dossier du projet
  #    test-phase1.ps1

  # 2. Ouvrir PowerShell dans le dossier du projet
  cd C:\Users\mmarc\Documents\Programming\myProjects\piYes_projects\piyes-wallet-backend

  # 3. Exécuter le script
  .\test-phase1.ps1

  # 4. Pendant l'exécution, quand le script te le demande,
  #    ouvrir Supabase SQL Editor et exécuter la requête SQL
  #    pour créer le ledger de demo6
```

## Exemple de sortie attendue

```
  ============================================
          TEST PHASE 1 - LEDGER
  ============================================

  📌 ÉTAPE 0 : Login demo3
  ✅ Login réussi

  📌 ÉTAPE 1 : Récupération du compte piYès
  ✅ Account ID : a5aae93b-71b8-4057-a228-1085d996f74b
  ✅ Solde initial : 0 HTG

  📌 ÉTAPE 2 : Dépôt de 500 HTG
  ✅ Dépôt réussi !

  📌 ÉTAPE 3 : Vérification du solde
  ✅ Solde après dépôt : 500 HTG

  📌 ÉTAPE 4 : Création de demo6
  ✅ demo6 créé avec succès
  ✅ ID demo6 : 12345678-1234-1234-1234-123456789abc

  📌 ÉTAPE 5 : Création du ledger pour demo6
  ⚠️  Exécute ce SQL dans Supabase SQL Editor :

  SELECT piyes_ledger_get_or_create_customer_account(
    '12345678-1234-1234-1234-123456789abc',
    'Demo 6',
    (SELECT "accountNumber" FROM "User" WHERE id = '12345678-1234-1234-1234-123456789abc'),
    '12345678-1234-1234-1234-123456789abc',
    0
  );

  Appuie sur Entrée après avoir exécuté le SQL dans Supabase...

  📌 ÉTAPE 6 : Transfert de 100 HTG vers demo6
  ✅ Transfert réussi !

  📌 ÉTAPE 7 : Vérification du solde après transfert
  ✅ Solde après transfert : 400 HTG

  📌 ÉTAPE 8 : Test d'idempotence (même clé)
  ▶️  Premier appel avec idempotencyKey = test-idempotency-001
  ✅ ID transaction 1 : abc123...
  ✅ payment_order_id 1 : def456...

  ▶️  Second appel avec la MÊME clé
  ✅ ID transaction 2 : xyz789...
  ✅ payment_order_id 2 : def456...

  ✅ IDEMPOTENCE VALIDÉE : même payment_order_id (def456...)
  ✅ Pas de double débit !

  📌 ÉTAPE 9 : Solde final
  ✅ Solde final : 400 HTG

  ============================================
          RÉSUMÉ DES TESTS
  ============================================

  ✅ Login demo3
  ✅ Dépôt 500 HTG
  ✅ Solde après dépôt : 400 HTG
  ✅ Transfert 100 HTG vers demo6
  ✅ Idempotence validée
  ✅ Pas de double débit

  🎉 TOUS LES TESTS DE LA PHASE 1 SONT VALIDÉS !
```
