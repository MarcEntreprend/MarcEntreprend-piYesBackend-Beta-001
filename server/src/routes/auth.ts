//server/src/routes/auth.ts

import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { supabase } from "../supabase.js";
import { otpService } from "../services/otpService.js";
import { loginSchema, signupSchema } from "../../../shared/schemas.js";
import { authMiddleware, AuthRequest } from "../middleware.js";

const router = express.Router();

const ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET || "piyes_access_secret_change_me_in_prod";
const REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || "piyes_refresh_secret_change_me_in_prod";

router.post("/logout-all", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    await supabase.from("Session").delete().eq("userId", userId);
    res.clearCookie("refreshToken");
    res.json({ success: true, message: "Logged out from all devices" });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/signup", async (req, res) => {
  try {
    const validated = signupSchema.parse(req.body);
    const device = validated.device || req.ip || "unknown";

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

    let baseTag = generateBaseTag(validated.name);
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
    validated.email = validated.email?.toLowerCase();

    // Fonction Title Case sécurisée
    const toTitleCase = (str?: string) =>
      (str || "") // si undefined, on met string vide
        .toLowerCase()
        .replace(/\b\w/g, (char) => char.toUpperCase());

    // Appliquer seulement si valeur existe
    validated.firstName = toTitleCase(validated.firstName);
    validated.lastName = toTitleCase(validated.lastName);

    // Fusionner pour colonne name
    validated.name =
      `${validated.firstName || ""} ${validated.lastName || ""}`.trim();

    const { data: user, error: userError } = await supabase
      .from("User")
      .insert({
        id: userId,
        firstName: validated.firstName, // <-- ajouté
        lastName: validated.lastName, // <-- ajouté
        name: validated.name, // fusion prénom + nom
        email: validated.email || null, // nullable — phone-only signup autorisé
        //email: validated.email,
        accountType: validated.accountType || "individual", // <-- ajouté
        passwordHash,
        tag,
        accountNumber,
        phone: validated.phone,
        balance: 0,
        verificationStatus: "unverified",
        isDeviceVerified: true, // First device is verified
        language: "Français",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .select()
      .single();

    if (userError || !user)
      throw userError || new Error("Failed to create user");

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
    // account( auto + phone-only)
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
    });
    const refreshToken = jwt.sign({ id: user.id }, REFRESH_SECRET, {
      expiresIn: "30d",
    });

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
    validated.email = validated.email?.toLowerCase();
    const device = validated.device || req.ip || "unknown";

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

    // message d'erreur login
    if (error || !user) {
      // Ne pas révéler si c'est l'email ou le phone qui n'existe pas (sécurité)
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
      console.log(`[AUTH] Login FAILED: Wrong password for user ${user.id}`);
      return res.status(401).json({
        error: {
          message:
            'Mot de passe incorrect. Veuillez réessayer ou utiliser "Mot de passe oublié".',
          code: "WRONG_PASSWORD",
        },
      });
    }

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
        { expiresIn: "10m" },
      );
      const otpCode = otpService.generateOtp(tempToken);
      const otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000);

      // Create a pending session
      await supabase.from("Session").insert({
        userId: user.id,
        token: tempToken,
        device,
        expiresAt: otpExpiresAt,
        otpCode,
        otpExpiresAt,
        isVerified: false,
      });

      return res.json({
        mfaRequired: true,
        requestId: tempToken,
        message: "OTP sent to your verified contact",
      });
    }

    // No other device, or same device
    const token = jwt.sign({ id: user.id, email: user.email }, ACCESS_SECRET, {
      expiresIn: "24h",
    });
    const refreshToken = jwt.sign({ id: user.id }, REFRESH_SECRET, {
      expiresIn: "30d",
    });

    // Update or create session
    // We'll just insert a new session for this device
    // If we want to limit to 1 device, we'd delete others first
    // await supabase.from('Session').delete().eq('userId', user.id);

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

    // Vérification OTP : accepter si le code correspond OU si l'otpService valide (TEST MODE)
    // En TEST MODE, otpService.verifyOtp retourne toujours true — donc ce check passe toujours
    const otpValid =
      otpService.verifyOtp(requestId, code, false) || session.otpCode === code;
    const notExpired =
      !session.otpExpiresAt || new Date() <= new Date(session.otpExpiresAt);

    if (!otpValid || !notExpired) {
      return res.status(400).json({
        error: { message: "Code incorrect ou expiré", code: "INVALID_OTP" },
      });
    }

    // MVP : supprimer TOUTES les autres sessions de cet user — une seule session active
    // Garantit qu'un seul device est connecté à la fois
    await supabase
      .from("Session")
      .delete()
      .eq("userId", session.userId)
      .neq("token", requestId);

    // Upgrade la session courante en session vérifiée
    const refreshToken = jwt.sign({ id: session.userId }, REFRESH_SECRET, {
      expiresIn: "30d",
    });
    const token = jwt.sign(
      { id: session.userId, email: session.user.email },
      ACCESS_SECRET,
      { expiresIn: "24h" },
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

    // Sauvegarder le nouveau token JWT dans la réponse
    // Le frontend (App.tsx handleLogin) le stockera dans localStorage
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
// In-memory store for OTPs (for demo purposes)
// Moved to otpService.ts for sharing across routes

router.post("/otp/request", async (req, res) => {
  try {
    const { contact, email, phone } = req.body;
    let target = contact || email || phone || "anonymous";

    // Normalize phone if it looks like one
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

    otpService.generateOtp(target);

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

    // Normalize identifier: trim and remove internal spaces
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

    // Check if user exists
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
    const otpCode = otpService.generateOtp(target);
    const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes

    // Delete any existing password reset sessions for this user
    await supabase
      .from("Session")
      .delete()
      .eq("userId", user.id)
      .eq("device", "password_reset");

    // Create a persistent session for password reset
    const { v4: uuidv4 } = await import("uuid");
    await supabase.from("Session").insert({
      id: uuidv4(),
      userId: user.id,
      token: `reset_${uuidv4()}`,
      device: "password_reset",
      otpCode,
      otpExpiresAt,
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

    // Normalize identifier: trim and remove internal spaces
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

    console.log(
      `[AUTH] Reset password attempt for: ${target} with code: ${code}`,
    );

    // Find the user first
    const { data: user } = await supabase
      .from("User")
      .select("id")
      .or(`email.eq.${target},phone.eq.${target}`)
      .maybeSingle();

    if (!user) {
      console.log(`[AUTH] Reset password FAILED: User not found for ${target}`);
      return res.status(400).json({ error: "Invalid or expired code" });
    }

    // Double vérification : otpService en mémoire ET session en BDD
    // En phase test : otpService accepte 000000 si une session existe en BDD
    const memoryValid = otpService.verifyOtp(target, code, false);

    // Find the password reset session in DB
    const { data: session, error: sessionError } = await supabase
      .from("Session")
      .select("*")
      .eq("userId", user.id)
      .eq("device", "password_reset")
      .eq("otpCode", code)
      .maybeSingle();

    // Accepter si au moins une des deux sources valide le code
    const dbValid =
      !sessionError &&
      !!session &&
      new Date() <= new Date(session.otpExpiresAt);

    if (!memoryValid && !dbValid) {
      return res.status(400).json({ error: "Invalid or expired code" });
    }

    if (session && new Date() > new Date(session.otpExpiresAt)) {
      console.log(
        `[AUTH] Reset password FAILED: Code expired pour user ${user.id}`,
      );
      return res.status(400).json({ error: "Invalid or expired code" });
    }

    // Update password
    const passwordHash = await bcrypt.hash(newPassword, 10);
    const { error: updateError } = await supabase
      .from("User")
      .update({ passwordHash })
      .eq("id", user.id);

    if (updateError) throw updateError;

    // Supprimer TOUTES les sessions de cet user après reset
    // Évite que les vieilles sessions déclenchent le MFA au prochain login
    await supabase.from("Session").delete().eq("userId", user.id);

    res.json({ success: true, message: "Password reset successfully" });
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

    const otpCode = otpService.generateOtp(requestId);

    // Check if this is a session token and update the DB if so
    const { data: session } = await supabase
      .from("Session")
      .select("id")
      .eq("token", requestId)
      .maybeSingle();

    if (session) {
      await supabase
        .from("Session")
        .update({
          otpCode,
          otpExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        })
        .eq("id", session.id);
    } else {
      // Check if this is a password reset session (requestId is email or phone)
      const { data: user } = await supabase
        .from("User")
        .select("id")
        .or(`email.eq.${requestId},phone.eq.${requestId}`)
        .maybeSingle();

      if (user) {
        await supabase
          .from("Session")
          .update({
            otpCode,
            otpExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          })
          .eq("userId", user.id)
          .eq("device", "password_reset");
      }
    }

    res.json({ success: true, message: "OTP resent successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to resend OTP" });
  }
});

router.post("/otp/verify", async (req, res) => {
  try {
    const { requestId, code, email, phone } = req.body;
    const target = requestId || email || phone;

    if (!target)
      return res.status(400).json({ error: "Target identifier is required" });

    const isValid = otpService.verifyOtp(target, code, false);

    if (!isValid) {
      console.log(
        `[SECURITY] OTP Verification FAILED for ${target} (Code: ${code})`,
      );
      return res.status(400).json({
        error: { message: "Invalid or expired code", code: "INVALID_OTP" },
      });
    }

    console.log(`[SECURITY] OTP Verification SUCCESS for ${target}`);

    // If the target is an email, mark the user as device verified
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
