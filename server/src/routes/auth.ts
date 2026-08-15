//server/src/routes/auth.ts

import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { supabase, supabaseService } from "../supabase.js";
import {
  createOtpChallenge,
  verifyOtpChallenge,
  hasActiveChallenge,
} from "../services/otpService.js";
import { sendOtp } from "../services/otpDeliveryService.js";
import { loginSchema, signupSchema } from "../../../shared/schemas.js";
import {
  authMiddleware,
  AuthRequest,
  JWT_ISSUER,
  JWT_AUDIENCE,
} from "../middleware.js";
import {
  lockoutKey,
  checkLockout,
  recordFailure,
  recordSuccess,
} from "../services/lockoutService.js";

const router = express.Router();

console.log(">>> [AUTH] auth.ts chargé !");
console.log(">>> [AUTH] router =", router);
console.log(">>> [AUTH] router.use =", typeof router?.use);

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
if (!ACCESS_SECRET || !REFRESH_SECRET) {
  throw new Error(
    "JWT_ACCESS_SECRET and JWT_REFRESH_SECRET are required (set them in .env)",
  );
}

router.post("/logout-all", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    await supabase.from("Session").delete().eq("userId", userId);
    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
    });
    res.json({ success: true, message: "Logged out from all devices" });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================
// POST /auth/refresh
// Renouvelle l'access token via le refresh token (cookie httpOnly).
// Rotation : un nouveau refresh token est émis, l'ancien est remplacé
// en base. Si un refresh token signé n'existe plus en base (rejeu d'un
// token révoqué), toutes les sessions de l'utilisateur sont purgées.
// ============================================================
router.post("/refresh", async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      return res.status(401).json({
        error: { message: "Refresh token manquant", code: "UNAUTHORIZED" },
      });
    }

    let payload: any;
    try {
      payload = jwt.verify(refreshToken, REFRESH_SECRET, {
        algorithms: ["HS256"],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
    } catch {
      return res.status(401).json({
        error: { message: "Refresh token invalide", code: "UNAUTHORIZED" },
      });
    }

    const { data: session, error } = await supabase
      .from("Session")
      .select("*")
      .eq("token", refreshToken)
      .eq("userId", payload.id)
      .maybeSingle();

    if (error || !session) {
      // Token signé mais absent en base → rejeu suspect : purge les sessions
      await supabase.from("Session").delete().eq("userId", payload.id);
      res.clearCookie("refreshToken", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "none",
      });
      return res.status(401).json({
        error: {
          message: "Session révoquée. Reconnectez-vous.",
          code: "UNAUTHORIZED",
        },
      });
    }

    if (!session.isVerified) {
      return res.status(401).json({
        error: {
          message: "Session non vérifiée (MFA requis)",
          code: "UNAUTHORIZED",
        },
      });
    }
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      await supabase.from("Session").delete().eq("id", session.id);
      return res.status(401).json({
        error: { message: "Session expirée", code: "UNAUTHORIZED" },
      });
    }

    const { data: user } = await supabase
      .from("User")
      .select("id, email")
      .eq("id", payload.id)
      .maybeSingle();
    if (!user) {
      return res.status(401).json({
        error: { message: "Utilisateur introuvable", code: "UNAUTHORIZED" },
      });
    }

    const newAccessToken = jwt.sign(
      { id: user.id, email: user.email },
      ACCESS_SECRET,
      {
        expiresIn: "24h",
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        jwtid: crypto.randomUUID(),
      },
    );
    const newRefreshToken = jwt.sign(
      { id: user.id, type: "refresh" },
      REFRESH_SECRET,
      {
        expiresIn: "30d",
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        jwtid: crypto.randomUUID(),
      },
    );

    // Rotation : remplace l'ancien refresh token en base
    await supabase
      .from("Session")
      .update({
        token: newRefreshToken,
        expiresAt: new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      })
      .eq("id", session.id);

    res.cookie("refreshToken", newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.json({
      token: newAccessToken,
      user: { id: user.id, email: user.email },
    });
  } catch (error) {
    console.error("Refresh error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/signup", async (req, res) => {
  try {
    const validated = signupSchema.parse(req.body);
    const device = validated.device || req.ip || "unknown";

    // Construction du nom d'affichage
    const displayName =
      validated.name ||
      `${validated.firstName || ""} ${validated.lastName || ""}`.trim() ||
      "user";

    // Robust tag generation
    const generateBaseTag = (name: string) => {
      return name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Remove accents
        .replace(/[^a-z0-9\s]/g, "") // Remove special chars
        .trim()
        .replace(/\s+/g, "_"); // Spaces to underscores
    };

    let baseTag = generateBaseTag(displayName);
    if (baseTag.length < 4) baseTag = baseTag.padEnd(4, "0");
    if (baseTag.length > 24) baseTag = baseTag.substring(0, 24); // Leave room for @ and potential suffix

    let tag = `@${baseTag}`;
    let counter = 1;
    let isUnique = false;

    while (!isUnique) {
      const { data: existingTag } = await supabase
        .from("User")
        .select("id")
        .eq("tag", tag)
        .single();

      if (!existingTag) {
        isUnique = true;
      } else {
        const suffix = counter.toString();
        const availableLength = 24 - suffix.length;
        tag = `@${baseTag.substring(0, availableLength)}${suffix}`;
        counter++;
      }
    }

    // Chercher user existant par email OU phone (selon ce qui est fourni)
    // Évite le crash quand email est null (phone-only signup)
    const conditions: string[] = [];
    if (validated.email) conditions.push(`email.eq.${validated.email}`);
    if (validated.phone) conditions.push(`phone.eq.${validated.phone}`);

    let existingUser = null;
    if (conditions.length > 0) {
      const { data } = await supabase
        .from("User")
        .select("id")
        .or(conditions.join(","))
        .maybeSingle();
      existingUser = data;
    }

    if (existingUser) {
      return res.status(400).json({
        error: {
          message: "Un compte existe déjà avec cet email ou téléphone",
          code: "USER_EXISTS",
        },
      });
    }

    const passwordHash = await bcrypt.hash(validated.password, 10);
    const accountNumber =
      Math.floor(100000 + Math.random() * 900000).toString() + "-6";

    // Use uuid v4 for robust ID generation
    const { v4: uuidv4 } = await import("uuid");
    const userId = uuidv4();

    // Format email en minuscules
    if (validated.email) {
      validated.email = validated.email.toLowerCase();
    }

    // Fonction Title Case sécurisée
    const toTitleCase = (str?: string) =>
      (str || "") // si undefined, on met string vide
        .toLowerCase()
        .replace(/\b\w/g, (char) => char.toUpperCase());

    // Appliquer seulement si valeur existe
    validated.firstName = toTitleCase(validated.firstName);
    validated.lastName = toTitleCase(validated.lastName);

    // Fusionner pour colonne name (utilise displayName si validated.name est vide)
    validated.name = displayName;

    const { data: user, error: userError } = await supabase
      .from("User")
      .insert({
        id: userId,
        firstName: validated.firstName,
        lastName: validated.lastName,
        name: validated.name,
        email: validated.email || null,
        accountType: validated.accountType || "individual",
        passwordHash,
        tag,
        accountNumber,
        phone: validated.phone,
        balance: 0,
        verificationStatus: "unverified",
        isDeviceVerified: true,
        language: "Français",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .select()
      .single();

    if (userError || !user)
      throw userError || new Error("Failed to create user");

    // Créer le ledger account pour ce nouvel utilisateur
    const { data: ledgerAccount, error: ledgerError } = await supabase.rpc(
      "piyes_ledger_get_or_create_customer_account",
      {
        p_customer_user_id: user.id,
        p_name: user.name,
        p_piyes_account_id: user.accountNumber,
        p_piyes_user_id: user.id,
        p_initial_balance_cents: 0,
      },
    );
    if (ledgerError)
      console.error("Ledger creation error (non-bloquant):", ledgerError);

    // --- CREATION BUSINESS PROFILE SI ENTREPRISE ---
    if (validated.accountType === "business") {
      const { v4: uuidv4bp } = await import("uuid");
      const { error: bpError } = await supabase.from("BusinessProfile").insert({
        id: uuidv4bp(),
        userId: user.id,
        companyName: validated.companyName || null,
        sector: validated.sector || null,
        nif: validated.nif || null,
        address: validated.address || null,
        repName: validated.repName || validated.name || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      if (bpError) console.error("BusinessProfile insert error:", bpError);
    }

    // Create default privacy settings
    await supabase.from("PrivacySettings").insert({
      userId: user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Créer le compte piYès avec permission = 'oui' et id UUID
    const { v4: uuidv4acc } = await import("uuid");
    const { error: accError } = await supabase.from("Account").insert({
      id: uuidv4acc(),
      userId: user.id,
      provider: "piyes",
      label: "piYès",
      balance: 0,
      color: "#830AD1",
      accountNumber,
      logoText: "P",
      logoUrl: null,
      status: "active",
      permission: "oui",
      isVerified: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    if (accError)
      console.error("Account creation error (non-bloquant):", accError);

    const token = jwt.sign({ id: user.id, email: user.email }, ACCESS_SECRET, {
      expiresIn: "24h",
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      jwtid: crypto.randomUUID(),
    });
    const refreshToken = jwt.sign(
      { id: user.id, type: "refresh" },
      REFRESH_SECRET,
      {
        expiresIn: "30d",
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        jwtid: crypto.randomUUID(),
      },
    );

    // Create session
    const { v4: uuidv4session } = await import("uuid");
    const { error: sessionError } = await supabase.from("Session").insert({
      id: uuidv4session(),
      userId: user.id,
      token: refreshToken,
      device,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      isVerified: true,
      createdAt: new Date().toISOString(),
    });
    if (sessionError)
      console.error("Session insert error (signup):", sessionError);

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.status(201).json({
      user: {
        id: user.id,
        name: user.name,
        tag: user.tag,
        email: user.email,
        phone: user.phone,
        accountNumber: user.accountNumber,
        avatarUrl: user.avatarUrl,
        balance: 0,
      },
      token,
    });
  } catch (error: any) {
    console.error("Signup error:", error);
    res
      .status(400)
      .json({ error: { message: error.message || "Validation failed" } });
  }
});

router.post("/login", async (req, res) => {
  try {
    const validated = loginSchema.parse(req.body);
    if (validated.email) {
      validated.email = validated.email.toLowerCase();
    }
    const device = validated.device || req.ip || "unknown";

    // Verrouillage par compte : anti-brute-force indépendant de l'IP
    const accountKey = lockoutKey(
      "login",
      (validated.email || validated.phone || "").toLowerCase(),
    );
    const lock = checkLockout(accountKey);
    if (lock.locked) {
      return res.status(429).json({
        error: {
          message: "Trop de tentatives. Réessayez plus tard.",
          code: "ACCOUNT_LOCKED",
        },
      });
    }

    let query = supabase.from("User").select("*");

    if (validated.email) {
      query = query.eq("email", validated.email);
    } else if (validated.phone) {
      query = query.eq("phone", validated.phone);
    } else {
      return res
        .status(400)
        .json({ error: { message: "Email or phone required" } });
    }

    const { data: user, error } = await query.single();

    // message d'erreur login (neutre : ne révèle pas si le compte existe)
    if (error || !user) {
      recordFailure(accountKey);
      console.log(
        `[AUTH] Login FAILED: User not found for ${validated.email || validated.phone}`,
      );
      return res.status(401).json({
        error: {
          message:
            "Identifiants incorrects. Vérifiez votre email/téléphone et mot de passe.",
          code: "INVALID_CREDENTIALS",
        },
      });
    }

    const isPasswordValid = await bcrypt.compare(
      validated.password,
      user.passwordHash,
    );
    if (!isPasswordValid) {
      recordFailure(accountKey);
      console.log(`[AUTH] Login FAILED: Wrong password for user ${user.id}`);
      return res.status(401).json({
        error: {
          message:
            "Identifiants incorrects. Vérifiez votre email/téléphone et mot de passe.",
          code: "INVALID_CREDENTIALS",
        },
      });
    }

    // Mot de passe correct → on réinitialise le compteur d'échecs
    recordSuccess(accountKey);

    // Vérifier si le compte est désactivé (permission 'non')
    const { data: userAccount } = await supabase
      .from("Account")
      .select("permission")
      .eq("userId", user.id)
      .eq("provider", "piyes")
      .maybeSingle();

    if (userAccount && userAccount.permission === "non") {
      console.log(`[AUTH] Login FAILED: Account disabled for user ${user.id}`);
      return res.status(403).json({
        error: {
          message:
            "Votre compte a été désactivé. Contactez le support à paiements@piyes.ht.",
          code: "ACCOUNT_DISABLED",
        },
      });
    }

    // Check for existing sessions on OTHER devices
    const { data: otherSessions } = await supabase
      .from("Session")
      .select("*")
      .eq("userId", user.id)
      .neq("device", device);

    if (otherSessions && otherSessions.length > 0) {
      // MFA Required
      const tempToken = jwt.sign(
        { id: user.id, isPending: true },
        REFRESH_SECRET,
        { expiresIn: "10m", issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
      );
      const target = user.email || user.phone || "";
      const challenge = await createOtpChallenge(target, "login_mfa");
      if (!challenge) {
        return res
          .status(500)
          .json({ error: "Failed to create OTP challenge" });
      }
      const otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000);
      await sendOtp(target, challenge.code, "connexion");

      // Create a pending session
      const { v4: uuidv4 } = await import("uuid");
      const { error: sessionInsertError } = await supabase
        .from("Session")
        .insert({
          id: uuidv4(),
          userId: user.id,
          token: tempToken,
          device,
          expiresAt: otpExpiresAt.toISOString(),
          otpCode: null,
          otpExpiresAt: otpExpiresAt.toISOString(),
          challengeId: challenge.id,
          isVerified: false,
          createdAt: new Date().toISOString(),
        });

      if (sessionInsertError) {
        console.error("Session insert error (MFA):", sessionInsertError);
        return res.status(500).json({ error: "Failed to create session" });
      }

      return res.json({
        mfaRequired: true,
        requestId: tempToken,
        message: "OTP sent to your verified contact",
      });
    }

    // No other device, or same device
    const token = jwt.sign({ id: user.id, email: user.email }, ACCESS_SECRET, {
      expiresIn: "24h",
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      jwtid: crypto.randomUUID(),
    });
    const refreshToken = jwt.sign(
      { id: user.id, type: "refresh" },
      REFRESH_SECRET,
      {
        expiresIn: "30d",
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        jwtid: crypto.randomUUID(),
      },
    );

    const { v4: uuidv4login } = await import("uuid");
    const { error: loginSessionError } = await supabase.from("Session").insert({
      id: uuidv4login(),
      userId: user.id,
      token: refreshToken,
      device,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      isVerified: true,
      createdAt: new Date().toISOString(),
    });
    if (loginSessionError)
      console.error("Session insert error (login):", loginSessionError);

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.json({
      user: {
        id: user.id,
        name: user.name,
        tag: user.tag,
        email: user.email,
        phone: user.phone,
        accountNumber: user.accountNumber,
        avatarUrl: user.avatarUrl,
        balance: user.balance / 100,
        isDeviceVerified: user.isDeviceVerified,
        hasPin: !!user.pinHash,
      },
      token,
    });
  } catch (error: any) {
    res
      .status(400)
      .json({ error: { message: error.message || "Validation failed" } });
  }
});

router.post("/verify-session-otp", async (req, res) => {
  try {
    const { requestId, code } = req.body;

    const { data: session, error } = await supabase
      .from("Session")
      .select("*, user:User(*)")
      .eq("token", requestId)
      .single();

    if (error || !session) {
      return res.status(400).json({
        error: {
          message: "Session introuvable ou expirée",
          code: "INVALID_SESSION",
        },
      });
    }

    // Verrouillage par compte OTP : anti-brute-force du code à 6 chiffres
    const otpKey = lockoutKey("otp", session.userId);
    const otpLock = checkLockout(otpKey);
    if (otpLock.locked) {
      return res.status(429).json({
        error: {
          message: "Trop de tentatives de code. Réessayez plus tard.",
          code: "OTP_LOCKED",
        },
      });
    }

    const otpValid = session.challengeId
      ? await verifyOtpChallenge(session.challengeId, code)
      : false;
    const notExpired =
      !session.otpExpiresAt || new Date() <= new Date(session.otpExpiresAt);

    if (!otpValid || !notExpired) {
      recordFailure(otpKey);
      return res.status(400).json({
        error: { message: "Code incorrect ou expiré", code: "INVALID_OTP" },
      });
    }

    recordSuccess(otpKey);

    await supabase
      .from("Session")
      .delete()
      .eq("userId", session.userId)
      .neq("token", requestId);

    const refreshToken = jwt.sign(
      { id: session.userId, type: "refresh" },
      REFRESH_SECRET,
      {
        expiresIn: "30d",
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        jwtid: crypto.randomUUID(),
      },
    );
    const token = jwt.sign(
      { id: session.userId, email: session.user.email },
      ACCESS_SECRET,
      {
        expiresIn: "24h",
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        jwtid: crypto.randomUUID(),
      },
    );

    await supabase
      .from("Session")
      .update({
        token: refreshToken,
        otpCode: null,
        otpExpiresAt: null,
        isVerified: true,
        expiresAt: new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      })
      .eq("id", session.id);

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.json({
      user: {
        id: session.user.id,
        name: session.user.name,
        tag: session.user.tag,
        email: session.user.email,
        phone: session.user.phone,
        accountNumber: session.user.accountNumber,
        avatarUrl: session.user.avatarUrl,
        balance: session.user.balance / 100,
        isDeviceVerified: true,
        hasPin: !!session.user.pinHash,
      },
      token,
    });
  } catch (error) {
    console.error("verify-session-otp error:", error);
    res.status(500).json({ error: "Verification failed" });
  }
});

// --- OTP ROUTES ---

router.post("/otp/request", async (req, res) => {
  try {
    const { contact, email, phone } = req.body;
    let target = contact || email || phone || "anonymous";

    if (
      target &&
      !target.includes("@") &&
      /^\d+$/.test(target.replace("+", ""))
    ) {
      target = target.startsWith("+")
        ? target
        : target.startsWith("509")
          ? `+${target}`
          : `+509${target}`;
    } else if (target && target.includes("@")) {
      target = target.toLowerCase();
    }

    const existing = await hasActiveChallenge(target, "generic");
    if (existing) {
      return res.status(429).json({
        error: {
          message: "Un code est déjà actif. Réessayez plus tard.",
          code: "OTP_ALREADY_ACTIVE",
        },
      });
    }

    const challenge = await createOtpChallenge(target, "generic");
    if (!challenge) {
      return res.status(500).json({ error: "Failed to create OTP challenge" });
    }
    await sendOtp(target, challenge.code, "vérification");

    res.json({
      success: true,
      message: "OTP sent successfully",
      requestId: target,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to request OTP" });
  }
});

router.post("/forgot-password", async (req, res) => {
  try {
    const { identifier } = req.body;
    if (!identifier)
      return res.status(400).json({ error: "Identifier is required" });

    let target = identifier.trim().replace(/\s+/g, "");
    if (!target.includes("@") && /^\d+$/.test(target.replace("+", ""))) {
      if (target.startsWith("+")) {
        // already has +
      } else if (target.startsWith("509")) {
        target = "+" + target;
      } else {
        target = "+509" + target;
      }
    } else if (target.includes("@")) {
      target = target.toLowerCase();
    }

    const { data: user } = await supabase
      .from("User")
      .select("id, email, phone")
      .or(`email.eq.${target},phone.eq.${target}`)
      .maybeSingle();

    if (!user) {
      return res.json({
        success: true,
        message: "If an account exists, an OTP has been sent.",
      });
    }

    console.log(`[FORGOT PASSWORD] Generating OTP for target: "${target}"`);
    const challenge = await createOtpChallenge(target, "password_reset");
    if (!challenge) {
      return res.status(500).json({ error: "Failed to create OTP challenge" });
    }
    const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await sendOtp(target, challenge.code, "réinitialisation du mot de passe");

    await supabase
      .from("Session")
      .delete()
      .eq("userId", user.id)
      .eq("device", "password_reset");

    const { v4: uuidv4 } = await import("uuid");
    await supabase.from("Session").insert({
      id: uuidv4(),
      userId: user.id,
      token: `reset_${uuidv4()}`,
      device: "password_reset",
      otpCode: null,
      otpExpiresAt,
      challengeId: challenge.id,
      isVerified: false,
      createdAt: new Date().toISOString(),
      expiresAt: otpExpiresAt,
    });

    res.json({
      success: true,
      message: "OTP sent successfully",
      requestId: target,
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/reset-password", async (req, res) => {
  try {
    const { identifier, code, newPassword } = req.body;
    if (!identifier || !code || !newPassword) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    let target = identifier.trim().replace(/\s+/g, "");
    if (!target.includes("@") && /^\d+$/.test(target.replace("+", ""))) {
      if (target.startsWith("+")) {
        // already has +
      } else if (target.startsWith("509")) {
        target = "+" + target;
      } else {
        target = "+509" + target;
      }
    } else if (target.includes("@")) {
      target = target.toLowerCase();
    }

    console.log(`[AUTH] Reset password attempt for: ${target}`);

    const { data: user } = await supabase
      .from("User")
      .select("id")
      .or(`email.eq.${target},phone.eq.${target}`)
      .maybeSingle();

    if (!user) {
      console.log(`[AUTH] Reset password FAILED: User not found for ${target}`);
      return res.status(400).json({ error: "Invalid or expired code" });
    }

    // Verrouillage par compte OTP (reset password)
    const resetOtpKey = lockoutKey("otp-reset", user.id);
    const resetLock = checkLockout(resetOtpKey);
    if (resetLock.locked) {
      return res.status(429).json({
        error: {
          message: "Trop de tentatives de code. Réessayez plus tard.",
          code: "OTP_LOCKED",
        },
      });
    }

    const { data: session, error: sessionError } = await supabase
      .from("Session")
      .select("*")
      .eq("userId", user.id)
      .eq("device", "password_reset")
      .maybeSingle();

    const challengeValid = session?.challengeId
      ? await verifyOtpChallenge(session.challengeId, code)
      : false;
    const dbValid =
      !sessionError &&
      !!session &&
      new Date() <= new Date(session.otpExpiresAt);

    if (!challengeValid || !dbValid) {
      recordFailure(resetOtpKey);
      return res.status(400).json({ error: "Invalid or expired code" });
    }

    recordSuccess(resetOtpKey);

    if (session && new Date() > new Date(session.otpExpiresAt)) {
      console.log(
        `[AUTH] Reset password FAILED: Code expired pour user ${user.id}`,
      );
      return res.status(400).json({ error: "Invalid or expired code" });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    const { error: updateError } = await supabase
      .from("User")
      .update({ passwordHash })
      .eq("id", user.id);

    if (updateError) throw updateError;

    await supabase.from("Session").delete().eq("userId", user.id);

    const { data: fullUser } = await supabase
      .from("User")
      .select("*")
      .eq("id", user.id)
      .single();

    if (!fullUser) {
      return res.status(500).json({ error: "User not found after reset" });
    }

    const token = jwt.sign(
      { id: fullUser.id, email: fullUser.email },
      ACCESS_SECRET,
      {
        expiresIn: "24h",
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        jwtid: crypto.randomUUID(),
      },
    );
    const refreshToken = jwt.sign(
      { id: fullUser.id, type: "refresh" },
      REFRESH_SECRET,
      {
        expiresIn: "30d",
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        jwtid: crypto.randomUUID(),
      },
    );

    const { v4: uuidv4 } = await import("uuid");
    await supabase.from("Session").insert({
      id: uuidv4(),
      userId: fullUser.id,
      token: refreshToken,
      device: "password_reset_auto_login",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      isVerified: true,
      createdAt: new Date().toISOString(),
    });

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
      message: "Password reset successfully",
      user: {
        id: fullUser.id,
        name: fullUser.name,
        tag: fullUser.tag,
        email: fullUser.email,
        phone: fullUser.phone,
        accountNumber: fullUser.accountNumber,
        avatarUrl: fullUser.avatarUrl,
        balance: fullUser.balance / 100,
        isDeviceVerified: true,
        hasPin: !!fullUser.pinHash,
      },
      token,
    });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/otp/resend", async (req, res) => {
  try {
    const { requestId } = req.body;
    if (!requestId)
      return res.status(400).json({ error: "requestId is required" });

    // requestId peut être un token de session (MFA / password reset) ou une
    // cible (email/téléphone) issue de /otp/request.
    const { data: session } = await supabase
      .from("Session")
      .select("*, user:User(email, phone)")
      .eq("token", requestId)
      .maybeSingle();

    if (session) {
      const target = session.user?.email || session.user?.phone || "";
      const purpose =
        session.device === "password_reset" ? "password_reset" : "login_mfa";
      const challenge = await createOtpChallenge(target, purpose);
      if (!challenge) {
        return res
          .status(500)
          .json({ error: "Failed to create OTP challenge" });
      }
      await sendOtp(target, challenge.code, "renvoi du code");
      await supabase
        .from("Session")
        .update({
          challengeId: challenge.id,
          otpCode: null,
          otpExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        })
        .eq("id", session.id);
      return res.json({ success: true, message: "OTP resent successfully" });
    }

    // Cible directe (email/téléphone)
    const directTarget = requestId.trim().replace(/\s+/g, "");
    const existingDirect = await hasActiveChallenge(directTarget, "generic");
    if (existingDirect) {
      return res.status(429).json({
        error: {
          message: "Un code est déjà actif. Réessayez plus tard.",
          code: "OTP_ALREADY_ACTIVE",
        },
      });
    }
    const challenge = await createOtpChallenge(directTarget, "generic");
    if (!challenge) {
      return res.status(500).json({ error: "Failed to create OTP challenge" });
    }
    await sendOtp(directTarget, challenge.code, "renvoi du code");
    res.json({ success: true, message: "OTP resent successfully" });
  } catch (error) {
    console.error("OTP resend error:", error);
    res.status(500).json({ error: "Failed to resend OTP" });
  }
});

router.post("/otp/verify", async (req, res) => {
  try {
    const { requestId, code, email, phone } = req.body;
    const target = requestId || email || phone;

    if (!target)
      return res.status(400).json({ error: "Target identifier is required" });
    if (!code) return res.status(400).json({ error: "Code is required" });

    // Retrouve le challenge actif le plus récent pour la cible
    const { data: challenge } = await supabaseService
      .from("otp_challenge")
      .select("id")
      .eq("target", target)
      .is("consumed_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const challengeId = challenge?.id;
    const isValid = challengeId
      ? await verifyOtpChallenge(challengeId, code)
      : false;

    if (!isValid) {
      console.log(`[SECURITY] OTP Verification FAILED for ${target}`);
      return res.status(400).json({
        error: { message: "Invalid or expired code", code: "INVALID_OTP" },
      });
    }

    console.log(`[SECURITY] OTP Verification SUCCESS for ${target}`);

    if (target.includes("@")) {
      await supabase
        .from("User")
        .update({ isDeviceVerified: true })
        .eq("email", target);
    }

    res.json({ success: true });
  } catch (error) {
    console.error("OTP verification error:", error);
    res.status(500).json({ error: "Failed to verify OTP" });
  }
});

export default router;
