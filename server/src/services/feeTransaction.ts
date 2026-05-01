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
