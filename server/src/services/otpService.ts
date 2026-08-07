// server/src/services/otpService.ts

import crypto from 'crypto';

interface OtpData {
  codeHash: string;
  expires: number;
  target: string;
  attempts: number;
  metadata?: any;
}

class OtpService {
  private otpStore = new Map<string, OtpData>();
  private readonly MAX_ATTEMPTS = 5;
  private readonly TTL_MS = 15 * 60 * 1000;

  private hash(code: string): string {
    return crypto.createHash("sha256").update(code).digest("hex");
  }

  generateOtp(target: string, metadata?: any): string {
    const code = crypto.randomInt(0, 1000000).toString().padStart(6, "0");
    this.otpStore.set(target, {
      codeHash: this.hash(code),
      expires: Date.now() + this.TTL_MS,
      target,
      attempts: 0,
      metadata,
    });

    this.logOtp(target, code);

    return code;
  }

  logOtp(target: string, code: string) {
    if (process.env.NODE_ENV === "production") return;
    console.log("\n" + "█".repeat(60));
    console.log("█" + " ".repeat(58) + "█");
    console.log("█" + "   [DEV] OTP CODE GENERATED".padEnd(58) + "█");
    console.log("█" + `   TARGET: ${target}`.padEnd(58) + "█");
    console.log("█" + `   CODE:   ${code}`.padEnd(58) + "█");
    console.log("█" + " ".repeat(58) + "█");
    console.log("█".repeat(60) + "\n");
    console.log(`[DEV] YOUR CODE IS: ${code}`);
  }

  verifyOtp(target: string, code: string, consume: boolean = true): boolean {
    const data = this.otpStore.get(target);
    if (!data || !code) return false;

    if (Date.now() > data.expires) {
      this.otpStore.delete(target);
      return false;
    }

    if (data.attempts >= this.MAX_ATTEMPTS) {
      this.otpStore.delete(target);
      return false;
    }

    const isValid = crypto.timingSafeEqual(
      Buffer.from(this.hash(code), "hex"),
      Buffer.from(data.codeHash, "hex"),
    );

    if (!isValid) {
      data.attempts += 1;
      return false;
    }

    if (consume) this.otpStore.delete(target);
    return true;
  }

  getMetadata(target: string) {
    return this.otpStore.get(target)?.metadata;
  }
}

export const otpService = new OtpService();
