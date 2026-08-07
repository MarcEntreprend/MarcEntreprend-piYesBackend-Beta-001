-- ============================================================
-- TEST PHASE 1 - SUPABASE
-- À exécuter dans le SQL Editor de Supabase
-- ============================================================

-- 1. Vérifier que les fonctions existent
SELECT proname FROM pg_proc 
WHERE proname IN ('piyes_ledger_post', 'piyes_ledger_get_or_create_customer_account', 'post_journal');

-- 2. Vérifier les tables
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('ledger_account', 'ledger_account_balance', 'journal_entry', 'journal_line', 'payment_order');

-- 3. Vérifier le compte caisse
SELECT id, code, name, is_system, allow_overdraft 
FROM ledger_account 
WHERE code = '1001';

-- 4. Voir les soldes de tous les utilisateurs
SELECT 
  la.customer_user_id,
  u.name,
  u.email,
  lab.balance_cents / 100 AS balance_HTG
FROM ledger_account la
JOIN ledger_account_balance lab ON lab.ledger_account_id = la.id
LEFT JOIN "User" u ON u.id = la.customer_user_id
ORDER BY la.customer_user_id;

-- 5. Voir les transactions récentes
SELECT 
  id,
  type,
  amount / 100 AS amount_HTG,
  role,
  counterpartyName,
  balance_after / 100 AS balance_after,
  date
FROM "Transaction"
ORDER BY date DESC
LIMIT 10;

-- 6. Voir les payment_order (idempotence)
SELECT 
  id,
  idempotency_key,
  type,
  status,
  amount_cents / 100 AS amount_HTG,
  created_at,
  updated_at
FROM payment_order
ORDER BY created_at DESC
LIMIT 10;