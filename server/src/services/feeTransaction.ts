// server/src/services/feeTransaction.ts

/**
 * Service de calcul des frais réels pour les transactions piYès
 * Règles métier :
 * - P2P (piYès → piYès) : 0%
 * - Recharge mobile : 0%
 * - Dépôt / Retrait : 0%
 * - Interbancaire sortant : 0.5%
 * - International : 1%
 */

export interface FeeCalculation {
  amountCents: number;
  feeCents: number;
  feePercent: number;
  feeType: "p2p" | "interbank_out" | "international" | "none";
}

/**
 * Calcule les frais pour une transaction donnée (en centimes)
 */
export function computeFeeForTransaction(tx: {
  type: string;
  description?: string | null;
  amount: number; // en centimes
}): FeeCalculation {
  const amountCents = tx.amount;

  // International → 1%
  if (tx.type === "INTERNATIONAL") {
    return {
      amountCents,
      feeCents: Math.round(amountCents * 0.01),
      feePercent: 1,
      feeType: "international",
    };
  }

  // Interbancaire sortant (détection via description ou type spécifique)
  const isInterbankOut =
    tx.description?.toLowerCase().includes("inter-bancaire") ||
    tx.description?.toLowerCase().includes("interbank") ||
    tx.type === "INTERBANK_OUT";

  if (isInterbankOut) {
    return {
      amountCents,
      feeCents: Math.round(amountCents * 0.005),
      feePercent: 0.5,
      feeType: "interbank_out",
    };
  }

  // P2P, recharge, dépôt, retrait → 0%
  return {
    amountCents,
    feeCents: 0,
    feePercent: 0,
    feeType: "none",
  };
}

/**
 * Calcule le total des frais pour une liste de transactions
 * @returns total des frais en gourdes (float)
 */
export function computeTotalFees(
  transactions: Array<{
    type: string;
    description?: string | null;
    amount: number;
  }>,
): number {
  const totalFeeCents = transactions.reduce((sum, tx) => {
    return sum + computeFeeForTransaction(tx).feeCents;
  }, 0);
  return totalFeeCents / 100; // conversion en gourdes
}

/**
 * Calcule les frais MonCash pour un montant donné (en centimes)
 * Basé sur le barème officiel MonCash (transfert MonCash → MonCash)
 */
export function computeMoncashFee(amountCents: number): number {
  const amountG = amountCents / 100;

  if (amountG < 250) return 0;
  if (amountG < 500) return 5;
  if (amountG < 1000) return 10;
  if (amountG < 2000) return 25;
  if (amountG < 4000) return 35;
  if (amountG < 8000) return 50;
  if (amountG < 12000) return 60;
  if (amountG < 20000) return 0; // tranche 12k-20k = 0 G.
  if (amountG < 40000) return 75;
  if (amountG < 60000) return 100;
  if (amountG < 75000) return 120;
  return 130; // 75k-100k
}

/**
 * Calcule les frais MonCash pour différents types de transaction
 */
export function computeMoncashFeeByTransactionType(tx: {
  type: string;
  amount: number;
}): number {
  const amountG = tx.amount / 100;

  switch (tx.type) {
    case "TRANSFER":
      // Barème MonCash-à-MonCash
      if (amountG < 250) return 0;
      if (amountG < 500) return 5;
      if (amountG < 1000) return 10;
      if (amountG < 2000) return 25;
      if (amountG < 4000) return 35;
      if (amountG < 8000) return 50;
      if (amountG < 12000) return 60;
      if (amountG < 20000) return 0;
      if (amountG < 40000) return 75;
      if (amountG < 60000) return 100;
      if (amountG < 75000) return 120;
      return 130;

    case "DEPOSIT":
      // Frais de Dépôt sur Votre Compte
      if (amountG >= 12000 && amountG < 20000) return 70;
      return 0;

    case "WITHDRAW":
      // Frais de Retrait
      if (amountG < 100) return 6;
      if (amountG < 250) return 12;
      if (amountG < 500) return 15;
      if (amountG < 1000) return 40;
      if (amountG < 2000) return 65;
      if (amountG < 4000) return 115;
      if (amountG < 8000) return 185;
      if (amountG < 12000) return 275;
      if (amountG < 20000) return 380;
      if (amountG < 40000) return 640;
      if (amountG < 60000) return 1050;
      if (amountG < 75000) return 1400;
      return 1600;

    case "INTERBANK_OUT":
      // Frais Kont Bankè (similaire retrait pour MVP)
      if (amountG < 1000) return 65;
      if (amountG < 2000) return 65;
      if (amountG < 4000) return 115;
      if (amountG < 8000) return 185;
      if (amountG < 12000) return 275;
      if (amountG < 20000) return 380;
      if (amountG < 40000) return 640;
      if (amountG < 60000) return 1050;
      if (amountG < 75000) return 1400;
      return 1600;

    default:
      return 0; // RECHARGE, INTERNATIONAL, etc.
  }
}

/**
 * Calcule les frais MonCash simulés pour une liste de transactions (tous types pertinents)
 */
export function computeSimulatedMoncashFees(
  transactions: Array<{ type: string; amount: number }>,
): number {
  const totalFeeCents = transactions.reduce((sum, tx) => {
    return sum + computeMoncashFeeByTransactionType(tx);
  }, 0);
  return totalFeeCents / 100;
}
