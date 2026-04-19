// server/src/routes/user.ts
import express from "express";
import { authMiddleware, AuthRequest } from "../middleware.js";
import { supabase } from "../supabase.js";
import { otpService } from "../services/otpService.js";
import crypto from "crypto";

const router = express.Router();

router.get("/sync", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    // Fetch user with related data using Supabase joins
    const { data: user, error } = await supabase
      .from("User")
      .select(
        `
        *,
        accounts:Account(*),
        cards:Card(*),
        keys:Key(*),
        privacySettings:PrivacySettings(*),
        scheduledPayments:ScheduledPayment(*),
        notifications:Notification(*)
      `,
      )
      .eq("id", userId)
      .single();

    // 401 déclenche le logout automatique dans httpClient.ts (dispatch piyes:auth_expired)
    if (error || !user)
      return res
        .status(401)
        .json({ error: "Session invalide — utilisateur introuvable" });

    // Fetch contacts where this user is the owner
    const { data: contacts } = await supabase
      .from("Contact")
      .select("*")
      .eq("userId", userId);

    user.contacts = contacts || [];

    // Fetch friendships
    const { data: friendships } = await supabase
      .from("Friendship")
      .select("*")
      .or(`requesterId.eq.${userId},receiverId.eq.${userId}`);

    const pendingScheduledPayments = (user.scheduledPayments || [])
      .filter((sp: any) => sp.status === "pending")
      .sort(
        (a: any, b: any) =>
          new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime(),
      );

    const notifications = (user.notifications || [])
      .sort(
        (a: any, b: any) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      )
      .map((n: any) => ({
        ...n,
        data: {
          route: n.route,
          targetId: n.targetId,
        },
      }));

    const unreadNotificationsCount = notifications.filter(
      (n: any) => !n.isRead,
    ).length;

    const accounts = (user.accounts || []).map((acc: any) => ({
      ...acc,
      balance: acc.balance / 100,
    }));

    // Ensure piYès account is always present and first
    const hasPiyes = accounts.some((a: any) => a.provider === "piyes");
    if (!hasPiyes) {
      accounts.unshift({
        id: "piyes-main",
        userId: user.id,
        provider: "piyes",
        label: "piYès",
        balance: user.balance / 100,
        color: "#830AD1",
        accountNumber: user.accountNumber,
        logoText: "P",
        status: "active",
      });
    } else {
      // Sort to put piYès first
      accounts.sort((a: any, b: any) =>
        a.provider === "piyes" ? -1 : b.provider === "piyes" ? 1 : 0,
      );
    }

    const { data: recentHistory } = await supabase
      .from("Transaction")
      .select("*")
      .eq("userId", userId)
      .order("date", { ascending: false })
      .limit(10);

    res.json({
      user: {
        id: user.id,
        name: user.name,
        tag: user.tag,
        email: user.email,
        accountNumber: user.accountNumber,
        balance: user.balance / 100,
        mfaEnabled: user.mfaEnabled,
        biometricsEnabled: user.biometricsEnabled,
        verificationStatus: user.verificationStatus,
        hasPin: !!user.pinHash,
        isDeviceVerified: user.isDeviceVerified,
        phone: user.phone,
        language: user.language,
        avatarUrl:
          user.avatarUrl && !user.avatarUrl.startsWith("data:")
            ? `${user.avatarUrl}${user.avatarUrl.includes("?") ? "&" : "?"}t=${Date.now()}`
            : user.avatarUrl || null,
        dob: user.dob,
        address: user.address,
        nationality: user.nationality,
        idNumber: user.idNumber,
        timezone: user.timezone,
        privacySettings: user.privacySettings?.[0] || user.privacySettings,
        secondaryKeys: user.keys || [],
      },
      accounts,
      recentHistory: (recentHistory || []).map((tx: any) => ({
        ...tx,
        amount: tx.amount / 100,
      })),
      cards: (user.cards || []).map((card: any) => ({
        ...card,
        limit: card.limit / 100,
      })),
      contacts: user.contacts || [],
      friendships: friendships || [],
      scheduledPayments: pendingScheduledPayments.map((sp: any) => ({
        ...sp,
        amount: sp.amount / 100,
      })),
      notifications: notifications.slice(0, 50),
      unreadNotificationsCount,
      serverTime: new Date().toISOString(),
      config: { maintenance: false, updateRequired: false },
    });
  } catch (error) {
    console.error("Sync error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post(
  "/notifications/mark-read",
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { id, all } = req.body;

      let query = supabase
        .from("Notification")
        .update({ isRead: true })
        .eq("userId", userId);

      if (all) {
        // No extra filter needed, already filtered by userId
      } else if (id) {
        query = query.eq("id", id);
      } else {
        return res.status(400).json({ error: "id or all required" });
      }

      const { error } = await query;
      if (error) throw error;

      res.json({ success: true });
    } catch (error) {
      console.error("Mark read error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

router.get("/tag", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { data: user } = await supabase
      .from("User")
      .select("tag")
      .eq("id", userId)
      .single();

    if (!user) return res.status(404).json({ error: "User not found" });

    res.json({ tag: user.tag });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/delete", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    // Fetch current user name
    const { data: user } = await supabase
      .from("User")
      .select("name")
      .eq("id", userId)
      .single();

    if (!user) return res.status(404).json({ error: "User not found" });

    // Anonymize user data
    const { error } = await supabase
      .from("User")
      .update({
        name: `erased-${user.name}`,
        passwordHash: "erased",
        pinHash: null,
        email: `erased-${userId}@piyes.app`, // Prevent email reuse or leaks
        phone: null,
        avatarUrl: null,
        verificationStatus: "deleted",
      })
      .eq("id", userId);

    if (error) throw error;

    // Delete sessions
    await supabase.from("Session").delete().eq("userId", userId);

    res.json({ success: true, message: "Account anonymized and deleted" });
  } catch (error) {
    console.error("Delete account error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/privacy", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const settings = req.body;
    const { id, userId: _, ...data } = settings;

    const { error } = await supabase
      .from("PrivacySettings")
      .upsert({ ...data, userId }, { onConflict: "userId" });

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error("Privacy update error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/avatar", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { avatarUrl } = req.body;
    if (!avatarUrl)
      return res.status(400).json({ error: "Avatar URL is required" });

    const { data: user, error } = await supabase
      .from("User")
      .update({ avatarUrl })
      .eq("id", userId)
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, avatarUrl: user.avatarUrl });
  } catch (error) {
    console.error("Avatar upload error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/profile", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const {
      name,
      tag,
      email,
      phone,
      dob,
      address,
      nationality,
      idNumber,
      language,
      timezone,
      avatarUrl,
      otpCode,
    } = req.body;

    // Fetch current user to compare
    const { data: currentUser } = await supabase
      .from("User")
      .select("*")
      .eq("id", userId)
      .single();

    if (!currentUser) return res.status(404).json({ error: "User not found" });

    // before "Désactiver OTP pour profile"
    // // Sensitive changes check (Email/Phone)
    // const normalizedPhone = phone ? (phone.startsWith('+') ? phone : (phone.startsWith('509') ? `+${phone}` : `+509${phone}`)) : phone;
    // const emailChanged = email && email.toLowerCase() !== currentUser.email.toLowerCase();
    // const phoneChanged = normalizedPhone && normalizedPhone !== currentUser.phone;

    // if (emailChanged || phoneChanged) {
    //   if (!otpCode) {
    //     return res.status(400).json({ error: 'OTP verification required for email or phone changes', code: 'OTP_REQUIRED' });
    //   }
    //   const target = emailChanged ? email.toLowerCase() : normalizedPhone;
    //   const isValid = otpService.verifyOtp(target, otpCode);
    //   if (!isValid) {
    //     return res.status(400).json({ error: 'Invalid or expired OTP code' });
    //   }
    // }

    // Désactiver OTP pour profile
    // TEST MODE MVP : OTP désactivé pour email/phone — accepté directement
    // TODO: réactiver le bloc OTP ci-dessous en production
    const normalizedPhone = phone
      ? phone.startsWith("+")
        ? phone
        : phone.startsWith("509")
          ? `+${phone}`
          : `+509${phone}`
      : phone;
    // (vérification OTP désactivée pour beta test)

    // Calculate initials if name is changed
    const initials = name
      ? name
          .trim()
          .split(/\s+/)
          .map((n: string) => n[0])
          .join("")
          .substring(0, 2)
          .toUpperCase()
      : undefined;

    const { data: user, error } = await supabase
      .from("User")
      .update({
        name,
        tag: tag?.toLowerCase(),
        email: email?.toLowerCase(),
        phone,
        dob,
        address,
        nationality,
        idNumber,
        language,
        timezone,
        avatarUrl,
        initials,
        updatedAt: new Date().toISOString(),
      })
      .eq("id", userId)
      .select(
        `
        *,
        privacySettings:PrivacySettings(*),
        keys:Key(*)
      `,
      )
      .single();

    if (error) throw error;

    res.json({
      id: user.id,
      name: user.name,
      tag: user.tag,
      email: user.email,
      accountNumber: user.accountNumber,
      balance: user.balance / 100,
      mfaEnabled: user.mfaEnabled,
      biometricsEnabled: user.biometricsEnabled,
      verificationStatus: user.verificationStatus,
      hasPin: !!user.pinHash,
      isDeviceVerified: user.isDeviceVerified,
      phone: user.phone,
      language: user.language,
      avatarUrl:
        user.avatarUrl && !user.avatarUrl.startsWith("data:")
          ? `${user.avatarUrl}${user.avatarUrl.includes("?") ? "&" : "?"}t=${Date.now()}`
          : user.avatarUrl || null,
      dob: user.dob,
      address: user.address,
      nationality: user.nationality,
      idNumber: user.idNumber,
      timezone: user.timezone,
      privacySettings: user.privacySettings?.[0] || user.privacySettings,
      secondaryKeys: user.keys || [],
    });
  } catch (error) {
    console.error("Profile update error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/pin", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { pin } = req.body;
    if (!pin || pin.length !== 4)
      return res.status(400).json({ error: "Invalid PIN" });

    const bcrypt = await import("bcryptjs");
    const pinHash = await bcrypt.hash(pin, 10);

    const { error } = await supabase
      .from("User")
      .update({ pinHash })
      .eq("id", userId);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error("PIN setup error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/pin/verify", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { pin } = req.body;
    if (!pin) return res.status(400).json({ error: "PIN is required" });

    const { data: user } = await supabase
      .from("User")
      .select("pinHash")
      .eq("id", userId)
      .single();

    if (!user || !user.pinHash) {
      return res.status(404).json({ error: "PIN not set" });
    }

    // TEST MODE MVP : accepte n'importe quel PIN sans vérification
    // TODO: remplacer par la vérification bcrypt en production :
    // const bcrypt = await import('bcryptjs');
    // const isValid = await bcrypt.compare(pin, user.pinHash);
    // if (!isValid) return res.status(400).json({ error: 'Invalid PIN' });

    res.json({ success: true });
  } catch (error) {
    console.error("PIN verification error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- SEARCH USERS ---
router.get("/search", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { q } = req.query;
    if (!q || typeof q !== "string" || q.length < 2) {
      return res.json([]);
    }

    const query = q.trim().toLowerCase();
    let dbQuery = supabase
      .from("User")
      .select("id, name, tag, phone, avatarUrl, initials, verificationStatus");

    if (query.startsWith("@")) {
      // Search by tag
      dbQuery = dbQuery.ilike("tag", `%${query}%`);
    } else if (query.startsWith("+") || /^\d+$/.test(query)) {
      // Search by phone
      dbQuery = dbQuery.ilike("phone", `%${query}%`);
    } else {
      // Search by name
      dbQuery = dbQuery.ilike("name", `%${query}%`);
    }

    const { data: users, error } = await dbQuery.limit(20);
    if (error) throw error;

    // Filter out current user and add cache buster to avatarUrl
    const filteredUsers = (users || [])
      .filter((u) => u.id !== userId)
      .map((u) => ({
        ...u,
        avatarUrl: u.avatarUrl
          ? `${u.avatarUrl}${u.avatarUrl.includes("?") ? "&" : "?"}t=${Date.now()}`
          : null,
      }));

    res.json(filteredUsers);
  } catch (error) {
    console.error("User search error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- KEYS MANAGEMENT ---
router.get("/keys/check-tag", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { tag } = req.query;
    if (!tag || typeof tag !== "string")
      return res.status(400).json({ error: "Tag required" });

    const cleanTag = tag.trim().toLowerCase();
    const tagWithAt = cleanTag.startsWith("@") ? cleanTag : `@${cleanTag}`;

    // Check Key table
    const { data: existingKey } = await supabase
      .from("Key")
      .select("id")
      .ilike("value", tagWithAt)
      .maybeSingle();
    if (existingKey) return res.json({ available: false });

    // Check User table
    const { data: existingUser } = await supabase
      .from("User")
      .select("id")
      .ilike("tag", tagWithAt)
      .maybeSingle();
    if (existingUser) return res.json({ available: false });

    res.json({ available: true });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/keys", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { type, value } = req.body;
    if (!type || !value)
      return res.status(400).json({ error: "Type and value are required" });

    // Validation
    const cleanValue = value.trim();
    if (type === "tag") {
      if (
        !cleanValue.startsWith("@") ||
        !/^[a-z0-9_]{4,25}$/.test(cleanValue.substring(1).toLowerCase())
      ) {
        return res.status(400).json({
          error: "Invalid tag format (@username, 4-25 chars, a-z0-9_)",
        });
      }
    } else if (type === "email") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanValue)) {
        return res.status(400).json({ error: "Invalid email format" });
      }
    } else if (type === "phone") {
      if (!/^\+509\d{8}$/.test(cleanValue)) {
        return res.status(400).json({
          error: "Invalid phone format (must be +509 followed by 8 digits)",
        });
      }
    }

    // Check uniqueness (case-insensitive for tags)
    const query = supabase.from("Key").select("id");
    if (type === "tag") {
      query.ilike("value", cleanValue);
    } else {
      query.eq("value", cleanValue);
    }

    const { data: existing } = await query.maybeSingle();
    if (existing) return res.status(400).json({ error: "Key already in use" });

    // Also check User table for tags
    if (type === "tag") {
      const { data: existingUserTag } = await supabase
        .from("User")
        .select("id")
        .ilike("tag", cleanValue)
        .maybeSingle();
      if (existingUserTag)
        return res.status(400).json({ error: "Tag already in use" });
    }

    const isVerified = type === "random" || type === "tag";

    if (isVerified) {
      const { data: key, error } = await supabase
        .from("Key")
        .insert({
          id: crypto.randomUUID(),
          userId,
          type,
          value: cleanValue,
          isVerified: true,
          createdAt: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;
      return res.json(key);
    } else {
      // email or phone - Use centralized otpService
      const requestId = crypto.randomUUID();
      otpService.generateOtp(requestId, {
        type,
        value: cleanValue,
        userId,
      });

      // Return a "pending" key object
      return res.json({
        id: requestId,
        userId,
        type,
        value: cleanValue,
        isVerified: false,
        createdAt: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error("Create key error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/keys/:id", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const id = req.params.id as string;

    const { error } = await supabase
      .from("Key")
      .delete()
      .eq("id", id)
      .eq("userId", userId);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post(
  "/keys/:id/verify",
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const id = req.params.id as string;
      const { code } = req.body;

      // // Check in centralized otpService
      // const isValid = otpService.verifyOtp(id, code, false);
      // if (isValid) {
      //   const metadata = otpService.getMetadata(id);
      //   if (!metadata || metadata.userId !== userId) {
      //     return res.status(403).json({ error: 'Forbidden or session expired' });
      //   }

      // NEW : BYPASSING
      const isValid = otpService.verifyOtp(id, code, false);
      if (isValid) {
        const metadata = otpService.getMetadata(id);

        // TEST MODE : si pas de metadata en mémoire (store purgé ou test),
        // on accepte quand même si la key existe déjà en DB (isVerified = true)
        // ou si on a le metadata avec le bon userId
        if (metadata && metadata.userId !== userId) {
          return res
            .status(403)
            .json({ error: "Forbidden or session expired" });
        }

        if (!metadata) {
          // Pas de metadata en mémoire — vérifier si la key existe déjà en BDD
          const { data: existingKey } = await supabase
            .from("Key")
            .select("id, isVerified")
            .eq("id", id)
            .eq("userId", userId)
            .maybeSingle();
          if (existingKey?.isVerified) return res.json(true);
          // En test mode : accepter sans metadata
          console.log(`[TEST MODE] Key verify without metadata for id=${id}`);
          return res.json(true);
        }

        // Valid! Insert into DB
        const { error } = await supabase.from("Key").insert({
          id, // Use the same ID (requestId)
          userId: metadata.userId,
          type: metadata.type,
          value: metadata.value,
          isVerified: true,
          createdAt: new Date().toISOString(),
        });

        if (error) throw error;

        otpService.verifyOtp(id, code, true); // Consume it now
        return res.json(true);
      }

      // Fallback for keys already in DB (though currently they don't have otpCode column)
      const { data: key } = await supabase
        .from("Key")
        .select("*")
        .eq("id", id)
        .eq("userId", userId)
        .single();

      if (!key) return res.status(404).json({ error: "Key not found" });
      if (key.isVerified) return res.json(true);

      // Since we know the DB doesn't have otpCode, we can't verify from DB
      return res.status(400).json({
        error: "Verification failed. Please try adding the key again.",
      });
    } catch (error) {
      console.error("Verify key error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// 10. GET QR DATA
router.get("/qr", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const { data: user } = await supabase
      .from("User")
      .select("id, name, tag, phone, email, avatarUrl")
      .eq("id", userId)
      .single();

    if (!user) return res.status(404).json({ error: "User not found" });

    // Point 11.1: QR code should be a JSON string with specific fields
    const qrData = JSON.stringify({
      id: user.id,
      name: user.name,
      tag: user.tag,
      phone: user.phone,
      email: user.email,
      avatarUrl: user.avatarUrl
        ? `${user.avatarUrl}${user.avatarUrl.includes("?") ? "&" : "?"}t=${Date.now()}`
        : null,
    });

    res.json({ qrData });
  } catch (error) {
    res.status(500).json({ error: "Failed to generate QR data" });
  }
});

// ── Mise à jour partielle d'un contact (edit contact)
router.patch(
  "/contact-update/:contactId",
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const { contactId } = req.params;
      const { name, tag, phone, email, randomKey } = req.body;

      const { data, error } = await supabase
        .from("Contact")
        .update({
          name,
          tag,
          phone,
          email,
          randomKey,
          updatedAt: new Date().toISOString(),
        })
        .eq("id", contactId)
        .eq("userId", userId)
        .select()
        .single();

      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  },
);

export default router;
