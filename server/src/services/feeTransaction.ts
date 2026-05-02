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
 * Calcule les frais MonCash pour un montant donné
 * Basé sur le barème officiel MonCash (transfert MonCash → MonCash)
 */
export function computeMoncashFee(amountCents: number): number {
  const amountG = amountCents / 100;
  let feeG = 0;
  if (amountG < 250) feeG = 0;
  else if (amountG < 500) feeG = 5;
  else if (amountG < 1000) feeG = 10;
  else if (amountG < 2000) feeG = 25;
  else if (amountG < 4000) feeG = 35;
  else if (amountG < 8000) feeG = 50;
  else if (amountG < 12000) feeG = 60;
  else if (amountG < 20000) feeG = 0;
  else if (amountG < 40000) feeG = 75;
  else if (amountG < 60000) feeG = 100;
  else if (amountG < 75000) feeG = 120;
  else feeG = 130;
  return feeG * 100; // retourne des centimes
}
/**
 * Calcule les frais MonCash pour différents types de transaction
 */
export function computeMoncashFeeByTransactionType(tx: {
  type: string;
  amount: number;
}): number {
  const amountG = tx.amount / 100;
  let feeG = 0;

  switch (tx.type) {
    case "TRANSFER":
      if (amountG < 250) feeG = 0;
      else if (amountG < 500) feeG = 5;
      else if (amountG < 1000) feeG = 10;
      else if (amountG < 2000) feeG = 25;
      else if (amountG < 4000) feeG = 35;
      else if (amountG < 8000) feeG = 50;
      else if (amountG < 12000) feeG = 60;
      else if (amountG < 20000) feeG = 0;
      else if (amountG < 40000) feeG = 75;
      else if (amountG < 60000) feeG = 100;
      else if (amountG < 75000) feeG = 120;
      else feeG = 130;
      break;
    case "DEPOSIT":
      if (amountG >= 12000 && amountG < 20000) feeG = 70;
      else feeG = 0;
      break;
    case "WITHDRAW":
      if (amountG < 100) feeG = 6;
      else if (amountG < 250) feeG = 12;
      else if (amountG < 500) feeG = 15;
      else if (amountG < 1000) feeG = 40;
      else if (amountG < 2000) feeG = 65;
      else if (amountG < 4000) feeG = 115;
      else if (amountG < 8000) feeG = 185;
      else if (amountG < 12000) feeG = 275;
      else if (amountG < 20000) feeG = 380;
      else if (amountG < 40000) feeG = 640;
      else if (amountG < 60000) feeG = 1050;
      else if (amountG < 75000) feeG = 1400;
      else feeG = 1600;
      break;
    case "INTERBANK_OUT":
      if (amountG < 1000) feeG = 65;
      else if (amountG < 2000) feeG = 65;
      else if (amountG < 4000) feeG = 115;
      else if (amountG < 8000) feeG = 185;
      else if (amountG < 12000) feeG = 275;
      else if (amountG < 20000) feeG = 380;
      else if (amountG < 40000) feeG = 640;
      else if (amountG < 60000) feeG = 1050;
      else if (amountG < 75000) feeG = 1400;
      else feeG = 1600;
      break;
    default:
      feeG = 0;
  }
  return feeG * 100; // retourne des centimes
}

/**
 * Calcule les frais MonCash simulés pour une liste de transactions (tous types pertinents)
 * additionne les centimes et divise par 100 pour obtenir des gourdes
 */
export function computeSimulatedMoncashFees(
  transactions: Array<{ type: string; amount: number }>,
): number {
  const totalFeeCents = transactions.reduce(
    (sum, tx) => sum + computeMoncashFeeByTransactionType(tx),
    0,
  );
  return totalFeeCents / 100;
}
