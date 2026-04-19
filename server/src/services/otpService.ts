// server/src/services/otpService.ts

import crypto from 'crypto';

interface OtpData {
  code: string;
  expires: number;
  target: string;
  metadata?: any;
}

class OtpService {
  private otpStore = new Map<string, OtpData>();
  
  // PHASE DE TEST : Toujours 000000
  private readonly TEST_CODE = '000000';

  generateOtp(target: string, metadata?: any): string {
    const code = this.TEST_CODE;
    const expires = Date.now() + 15 * 60 * 1000; // 15 minutes
    
    this.otpStore.set(target, {
      code,
      expires,
      target,
      metadata
    });

    this.logOtp(target, code);

    return code;
  }

  logOtp(target: string, code: string) {
    console.log('\n' + '█'.repeat(60));
    console.log('█' + ' '.repeat(58) + '█');
    console.log('█' + '   [SECURITY] OTP CODE GENERATED'.padEnd(58) + '█');
    console.log('█' + `   TARGET: ${target}`.padEnd(58) + '█');
    console.log('█' + `   CODE:   ${code}`.padEnd(58) + '█');
    console.log('█' + ' '.repeat(58) + '█');
    console.log('█'.repeat(60) + '\n');
    console.log(`[SECURITY] YOUR CODE IS: ${code}`);
  }

  // Accepter N'IMPORTE quel code en test
  verifyOtp(target: string, code: string, consume: boolean = true): boolean {
    // TEST MODE : accepte n'importe quel code (même vide)
    // TODO: désactiver en production
    if (consume) this.otpStore.delete(target);
    return true;
  }

// before "Accepter N'IMPORTE quel code en test"
  // verifyOtp(target: string, code: string, consume: boolean = true): boolean {
  //   // En phase de test, on accepte 000000 si une demande a été faite (ou même sans demande pour être souple)
  //   if (code !== this.TEST_CODE) return false;

  //   const data = this.otpStore.get(target);
  //   if (!data) {
  //     // Pour le test, on accepte 000000 même si le store a été purgé ou si le target est légèrement différent
  //     return true;
  //   }
    
  //   if (Date.now() > data.expires) {
  //     this.otpStore.delete(target);
  //     return false;
  //   }

  //   if (consume) {
  //     this.otpStore.delete(target);
  //   }
  //   return true;
  // }

  getMetadata(target: string) {
    return this.otpStore.get(target)?.metadata;
  }
}

export const otpService = new OtpService();
