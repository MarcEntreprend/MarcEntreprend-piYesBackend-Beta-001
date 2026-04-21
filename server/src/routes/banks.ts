import express from "express";
import { authMiddleware, AuthRequest } from "../middleware.js";
import { supabase } from "../supabase.js";
import crypto from "crypto";

const router = express.Router();

router.get("/available", authMiddleware, async (req: AuthRequest, res) => {
  // Return the same list as in the frontend service for consistency
  res.json([
    {
      id: "b1",
      name: "Unibank",
      color: "#083a6b",
      provider: "unibank",
      logoUrl:
        "https://pbs.twimg.com/profile_images/1876372583295188992/E63UQYie_400x400.jpg",
      logoText: "U",
    },
    {
      id: "b2",
      name: "MonCash",
      color: "#E10600",
      provider: "moncash",
      logoUrl:
        "https://sandbox.moncashbutton.digicelgroup.com/Moncash-business/resources/assets/images/MonCash.png",
      logoText: "M",
    },
    {
      id: "b3",
      name: "Sogebank",
      color: "#002F6C",
      provider: "sogebank",
      logoUrl:
        "https://play-lh.googleusercontent.com/PmB2rC1Unl3JZ8dbl_Vy0oMGK4btov92DFJoo-_709IWl9Da8ZsVigTcC6wudALIXQ=w600-h300-pc0xffffff-pd",
      logoText: "S",
    },
    {
      id: "b4",
      name: "BNC",
      color: "#448bc9",
      provider: "bnc",
      logoUrl: "https://upload.wikimedia.org/wikipedia/fr/6/62/BNC.jpg",
      logoText: "B",
    },
    {
      id: "b5",
      name: "Capital Bank",
      color: "#fbeeeb",
      provider: "capitalbank",
      logoUrl: "https://app.haitieconomie.com/he-images/logo-capital.png",
      logoText: "C",
    },
    {
      id: "b6",
      name: "BUH",
      color: "##f7941d",
      provider: "buh",
      logoUrl:
        "https://play-lh.googleusercontent.com/g6SkmV9eK1pdyVQpJS8x7VtPZnJlQ77GpDtI_U4JRj3fdeDlD7gHZxl8mtzxTL1pZkKD",
      logoText: "BUH",
    },
    {
      id: "b7",
      name: "SOGEBEL",
      color: "#45505d",
      provider: "sogebel",
      logoUrl:
        "https://scontent.fcgh15-1.fna.fbcdn.net/v/t39.30808-6/472830484_10231787027632413_509798143400489335_n.jpg?_nc_cat=109&ccb=1-7&_nc_sid=1d70fc&_nc_eui2=AeGGWsENZsLeS9QWxEx8ppHZCTkN_NPgfkwJOQ380-B-TB9yIjedq9Dy3dlij1RyavU8Y8MSU9D-HAXsId7jkyx8&_nc_ohc=o45qJpN9CdgQ7kNvwFp5Wed&_nc_oc=Ado_WfR3cOh9n6Qwr3M7Q2IOAjTobvUpmNvI49KZI8benkJhlx5ksl0mCEISwYPzwKY&_nc_zt=23&_nc_ht=scontent.fcgh15-1.fna&_nc_gid=WZbWR_YcUG3U97fTkJtl2Q&_nc_ss=7a3a8&oh=00_Af3Xv97PY30KusQQrpGze-sAA_v5uQtndV-8G_iOogfdWg&oe=69ECC4C2",
      logoText: "SB",
    },
    {
      id: "b8",
      name: "BPH",
      color: "#009b65",
      provider: "bph",
      logoUrl: "https://app.haitieconomie.com/he-images/logo-bph.png",
      logoText: "BP",
    },
  ]);
});

router.post("/link", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    let { bankId, username, password, credentials } = req.body;

    // Support both flattened and nested credentials
    if (credentials) {
      username = username || credentials.username;
      password = password || credentials.password;
    }

    if (!bankId || !username) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Find bank details to populate the account record
    const banks = [
      {
        id: "b1",
        name: "Unibank",
        color: "#083a6b",
        provider: "unibank",
        logoUrl:
          "https://pbs.twimg.com/profile_images/1876372583295188992/E63UQYie_400x400.jpg",
        logoText: "U",
      },
      {
        id: "b2",
        name: "MonCash",
        color: "#E10600",
        provider: "moncash",
        logoUrl:
          "https://sandbox.moncashbutton.digicelgroup.com/Moncash-business/resources/assets/images/MonCash.png",
        logoText: "M",
      },
      {
        id: "b3",
        name: "Sogebank",
        color: "#002F6C",
        provider: "sogebank",
        logoUrl:
          "https://play-lh.googleusercontent.com/PmB2rC1Unl3JZ8dbl_Vy0oMGK4btov92DFJoo-_709IWl9Da8ZsVigTcC6wudALIXQ=w600-h300-pc0xffffff-pd",
        logoText: "S",
      },
      {
        id: "b4",
        name: "BNC",
        color: "#448bc9",
        provider: "bnc",
        logoUrl: "https://upload.wikimedia.org/wikipedia/fr/6/62/BNC.jpg",
        logoText: "B",
      },
      {
        id: "b5",
        name: "Capital Bank",
        color: "#fbeeeb",
        provider: "capitalbank",
        logoUrl: "https://app.haitieconomie.com/he-images/logo-capital.png",
        logoText: "C",
      },
      {
        id: "b6",
        name: "BUH",
        color: "##f7941d",
        provider: "buh",
        logoUrl:
          "https://play-lh.googleusercontent.com/g6SkmV9eK1pdyVQpJS8x7VtPZnJlQ77GpDtI_U4JRj3fdeDlD7gHZxl8mtzxTL1pZkKD",
        logoText: "BUH",
      },
      {
        id: "b7",
        name: "SOGEBEL",
        color: "#45505d",
        provider: "sogebel",
        logoUrl:
          "https://scontent.fcgh15-1.fna.fbcdn.net/v/t39.30808-6/472830484_10231787027632413_509798143400489335_n.jpg?_nc_cat=109&ccb=1-7&_nc_sid=1d70fc&_nc_eui2=AeGGWsENZsLeS9QWxEx8ppHZCTkN_NPgfkwJOQ380-B-TB9yIjedq9Dy3dlij1RyavU8Y8MSU9D-HAXsId7jkyx8&_nc_ohc=o45qJpN9CdgQ7kNvwFp5Wed&_nc_oc=Ado_WfR3cOh9n6Qwr3M7Q2IOAjTobvUpmNvI49KZI8benkJhlx5ksl0mCEISwYPzwKY&_nc_zt=23&_nc_ht=scontent.fcgh15-1.fna&_nc_gid=WZbWR_YcUG3U97fTkJtl2Q&_nc_ss=7a3a8&oh=00_Af3Xv97PY30KusQQrpGze-sAA_v5uQtndV-8G_iOogfdWg&oe=69ECC4C2",
        logoText: "SB",
      },
      {
        id: "b8",
        name: "BPH",
        color: "#009b65",
        provider: "bph",
        logoUrl: "https://app.haitieconomie.com/he-images/logo-bph.png",
        logoText: "BP",
      },
    ];

    const bank = banks.find((b) => b.id === bankId);
    if (!bank) return res.status(404).json({ error: "Bank not found" });

    // Password is required for all banks except MonCash
    if (bank.provider !== "moncash" && !password) {
      return res.status(400).json({ error: "Password is required" });
    }

    let isVerified = false;
    let kycStatus = "unverified";

    // MonCash specific logic
    if (bank.provider === "moncash") {
      try {
        const { moncashService } =
          await import("../services/moncashService.js");
        const status = await moncashService.getCustomerStatus(
          username,
          password,
        );
        kycStatus = status.type;
        isVerified =
          status.type === "fullkyc" && status.status.includes("active");
      } catch (error) {
        console.error("MonCash KYC check failed:", error);
        // We still allow linking for simulation if it fails, but not verified
      }
    }

    const newAccount = {
      id: crypto.randomUUID(),
      userId,
      provider: bank.provider,
      label: bank.name,
      balance: 0, // Initial balance is now 0 as requested
      color: bank.color,
      accountNumber:
        bank.provider === "moncash"
          ? username
          : `**** ${Math.floor(1000 + Math.random() * 9000)}`,
      logoText: bank.logoText,
      logoUrl: bank.logoUrl,
      status: "active",
      isVerified,
      kycStatus,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("Account")
      .insert(newAccount)
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error("Link bank error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;

    // Check if it's the piyes account
    const { data: account } = await supabase
      .from("Account")
      .select("provider")
      .eq("id", id)
      .eq("userId", userId)
      .single();

    if (account?.provider === "piyes") {
      return res
        .status(403)
        .json({ error: "Cannot delete the primary piYès account" });
    }

    // SOFT DELETE: Mark as inactive and set balance to 0
    const { error } = await supabase
      .from("Account")
      .update({
        status: "inactive",
        balance: 0,
        updatedAt: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("userId", userId);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error("Unlink bank error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get(
  "/:id/transactions",
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;

      const { data, error } = await supabase
        .from("Transaction")
        .select("*")
        .eq("accountId", id)
        .eq("userId", userId)
        .order("date", { ascending: false });

      if (error) throw error;

      res.json(data);
    } catch (error) {
      console.error("Fetch bank transactions error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
