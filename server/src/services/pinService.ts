// server/src/services/pinService.ts

import bcrypt from "bcryptjs";

export async function verifyPin(pinHash: string | null | undefined, pin: string) {
  if (!pinHash) {
    const err: any = new Error("PIN non configuré");
    err.code = "PIN_NOT_SET";
    throw err;
  }
  const valid = await bcrypt.compare(pin, pinHash);
  if (!valid) {
    const err: any = new Error("PIN incorrect");
    err.code = "INVALID_PIN";
    throw err;
  }
}
