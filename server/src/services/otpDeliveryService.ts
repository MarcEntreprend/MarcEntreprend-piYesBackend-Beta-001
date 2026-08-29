// server/src/services/otpDeliveryService.ts
//
// Phase 6 — Livraison des codes OTP.
//
// Canaux, par ordre de priorité :
//   1. Email via Resend (si RESEND_API_KEY défini)
//   2. SMS via Twilio (si TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN définis)
//   3. Dev : log console (si NODE_ENV !== "production")
//
// Le service ne reçoit que le code et la cible ; il ne gère ni la création
// ni la vérification (voir otpService.ts).

import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const FROM_EMAIL = process.env.OTP_FROM_EMAIL || "piyes@piyes.app";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_FROM = process.env.TWILIO_FROM || "";

export type OtpChannel = "email" | "sms" | "dev";

// Détermine le canal pour une cible : un email → email ; un +509 → SMS ;
// sinon dev (console) tant qu'aucun provider n'est configuré.
export function detectChannel(target: string): OtpChannel {
  if (target.includes("@")) {
    return RESEND_API_KEY ? "email" : "dev";
  }
  if (target.startsWith("+")) {
    return TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM
      ? "sms"
      : "dev";
  }
  return "dev";
}

// Envoie un code OTP à une cible. Retourne le canal réellement utilisé.
export async function sendOtp(
  target: string,
  code: string,
  purpose: string,
): Promise<{ channel: OtpChannel; ok: boolean; devCode?: string }> {
  const channel = detectChannel(target);
  const isDevMode = process.env.NODE_ENV !== "production" || process.env.DEV_OTP_MODE === "true";

  if (channel === "email") {
    try {
      const resend = new Resend(RESEND_API_KEY);
      await resend.emails.send({
        from: FROM_EMAIL,
        to: target,
        subject: `Votre code piYès (${purpose})`,
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:auto">
            <h2>piYès</h2>
            <p>Votre code de vérification est :</p>
            <div style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#830AD1">${code}</div>
            <p>Ce code expire dans 15 minutes. Si vous n'êtes pas à l'origine de cette
            demande, ignorez cet email.</p>
          </div>
        `,
      });
      return { channel: "email", ok: true };
    } catch (e) {
      console.error("[OTP] Resend delivery failed:", e);
      return { channel: "email", ok: false };
    }
  }

  if (channel === "sms") {
    try {
      const twilioModule: any = await import("twilio");
      const Twilio = twilioModule.default || twilioModule.Twilio;
      const client = new Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
      await client.messages.create({
        body: `piYès : votre code est ${code}. Valable 15 min.`,
        from: TWILIO_FROM,
        to: target,
      });
      return { channel: "sms", ok: true };
    } catch (e) {
      console.error("[OTP] Twilio delivery failed:", e);
      return { channel: "sms", ok: false };
    }
  }

  // Dev : journalisation console + retour du code si DEV_OTP_MODE
  const isDevMode = process.env.NODE_ENV !== "production" || process.env.DEV_OTP_MODE === "true";
  if (isDevMode) {
    console.log("\n" + "█".repeat(60));
    console.log("█" + " ".repeat(58) + "█");
    console.log("█" + "   [DEV] OTP CODE GENERATED".padEnd(58) + "█");
    console.log("█" + `   TARGET: ${target}`.padEnd(58) + "█");
    console.log("█" + `   PURPOSE: ${purpose}`.padEnd(58) + "█");
    console.log("█" + `   CODE:   ${code}`.padEnd(58) + "█");
    console.log("█" + " ".repeat(58) + "█");
    console.log("█".repeat(60) + "\n");
    console.log(`[DEV] YOUR OTP IS: ${code}`);
    return { channel: "dev", ok: true, devCode: code };
  }
  return { channel: "dev", ok: true };
}
