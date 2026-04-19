// server\src\routes\services.ts

import express from "express";
import { authMiddleware, AuthRequest } from "../middleware.js";
import { supabase } from "../supabase.js";
import { TransactionType, TransactionRole } from "../../../shared/types.js";

const router = express.Router();

// 1. LIST SERVICES / ADS
router.get("/list", async (req, res) => {
  try {
    const { data: ads, error } = await supabase
      .from("Ad")
      .select(
        `
        *,
        user:User(name, avatarUrl, tag)
      `,
      )
      .order("createdAt", { ascending: false })
      .limit(50);

    if (error) throw error;

    res.json(
      (ads || []).map((ad: any) => ({
        id: ad.id,
        title: ad.title,
        description: ad.description,
        price: ad.price / 100,
        location: ad.location,
        category: ad.category,
        images: JSON.parse(ad.images || "[]"),
        rating: ad.rating,
        views: ad.views,
        date: ad.createdAt,
        seller: {
          id: ad.user?.tag,
          name: ad.user?.name,
          avatar: ad.user?.avatarUrl || "",
          acceptsPiyes: true,
        },
      })),
    );
  } catch (error) {
    console.error("Service list error:", error);
    res.status(500).json({ error: "Failed to fetch services" });
  }
});

// 2. PAY SERVICE / PROVIDER
router.post("/pay", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { providerTag, amount, description } = req.body;
    const amountCents = Math.round(amount * 100);

    const { data: sender } = await supabase
      .from("User")
      .select("*")
      .eq("id", userId)
      .single();
    if (!sender || sender.balance < amountCents) {
      throw new Error("Insufficient balance");
    }

    const { data: receiver } = await supabase
      .from("User")
      .select("*")
      .eq("tag", providerTag)
      .single();
    if (!receiver) throw new Error("Provider not found");

    // Update balances
    await supabase
      .from("User")
      .update({
        balance: sender.balance - amountCents,
        updatedAt: new Date().toISOString(),
      })
      .eq("id", sender.id);
    await supabase
      .from("User")
      .update({
        balance: receiver.balance + amountCents,
        updatedAt: new Date().toISOString(),
      })
      .eq("id", receiver.id);

    const txCode = "SRV-" + Math.floor(100000 + Math.random() * 900000);
    const { v4: uuidv4 } = await import("uuid");
    const { data: transaction } = await supabase
      .from("Transaction")
      .insert({
        id: uuidv4(),
        type: TransactionType.TRANSFER,
        amount: amountCents,
        description: description || `Payment to ${receiver.name}`,
        role: TransactionRole.PAYER,
        counterpartyName: receiver.name,
        userId: sender.id,
        external_id: txCode,
        date: new Date().toISOString(),
      })
      .select()
      .single();

    res.json(transaction);
  } catch (error: any) {
    res
      .status(400)
      .json({ error: { message: error.message || "Payment failed" } });
  }
});

export default router;
