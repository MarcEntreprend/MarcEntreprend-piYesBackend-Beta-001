// server/src/routes/transactions.ts

import express from "express";
import { authMiddleware, AuthRequest } from "../middleware.js";
import { supabase } from "../supabase.js";
import * as bcrypt from "bcryptjs";
import crypto from "crypto";
import {
  transferSchema,
  rechargeSchema,
  requestPaymentSchema,
  schedulePaymentSchema,
  depositWithdrawSchema,
  interBankTransferSchema,
} from "../../../shared/schemas.js";
import { TransactionType, TransactionRole } from "../../../shared/types.js";
import {
  computeTotalFees,
  computeSimulatedMoncashFees,
} from "../services/feeTransaction.js";

const router = express.Router();

// Helper to generate unique IDs
const generateId = () => crypto.randomUUID();

// Helper to generate transaction codes
const generateTxCode = () => {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const prefix =
    letters[Math.floor(Math.random() * 26)] +
    letters[Math.floor(Math.random() * 26)];
  const numbers = Math.floor(100000 + Math.random() * 900000);
  return `${prefix}-${numbers}`;
};

// Helper to generate authorization codes
const generateAuthCode = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

// Helper to ensure a piyes account exists for a user, create if missing
async function ensurePiyesAccount(
  userId: string,
  userBalance: number,
  userAccountNumber: string,
): Promise<string> {
  // Check existing piyes account
  const { data: existing } = await supabase
    .from("Account")
    .select("id")
    .eq("userId", userId)
    .eq("provider", "piyes")
    .maybeSingle();

  if (existing) {
    return existing.id;
  }

  // Create missing piyes account
  const newAccountId = generateId();
  const { error: insertError } = await supabase.from("Account").insert({
    id: newAccountId,
    userId: userId,
    provider: "piyes",
    label: "piYès",
    balance: userBalance,
    accountNumber: userAccountNumber,
    color: "#830AD1",
    logoText: "P",
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    permission: "oui",
  });

  if (insertError) {
    console.error(
      "Failed to create piyes account for user",
      userId,
      insertError,
    );
    throw new Error("Impossible de créer le compte piYès du destinataire");
  }

  return newAccountId;
}

// 1. TRANSFER
router.post("/transfer", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const validated = transferSchema.parse(req.body);
    const amountCents = Math.round(validated.amount * 100);

    // Fetch sender
    const { data: sender, error: senderError } = await supabase
      .from("User")
      .select("*")
      .eq("id", userId)
      .single();

    if (senderError || !sender) throw new Error("User not found");

    console.log(`[TEST MODE] PIN bypass for user ${sender.id}`);

    if (sender.balance < amountCents) {
      throw new Error("Insufficient balance");
    }

    // Find receiver
    let receiver = null;

    const { data: userReceiver } = await supabase
      .from("User")
      .select("*")
      .or(
        `id.eq."${validated.contactId}",tag.ilike."${validated.contactId}",accountNumber.eq."${validated.contactId}",phone.eq."${validated.contactId}"`,
      )
      .maybeSingle();

    if (userReceiver) {
      receiver = userReceiver;
    } else {
      const { data: keyMatch } = await supabase
        .from("Key")
        .select("userId")
        .eq("value", validated.contactId)
        .eq("isVerified", true)
        .maybeSingle();

      if (keyMatch) {
        const { data: userByKey } = await supabase
          .from("User")
          .select("*")
          .eq("id", keyMatch.userId)
          .single();
        receiver = userByKey;
      }
    }

    if (!receiver) throw new Error("Receiver not found");
    if (receiver.id === sender.id)
      throw new Error("Cannot transfer to yourself");

    // Permission check
    const { data: receiverPermAccount } = await supabase
      .from("Account")
      .select("permission")
      .eq("userId", receiver.id)
      .eq("provider", "piyes")
      .maybeSingle();

    if (!receiverPermAccount || receiverPermAccount.permission !== "oui") {
      throw new Error(
        "Ce destinataire ne peut pas recevoir de paiements pour le moment",
      );
    }

    // Ensure piyes accounts exist for both sender and receiver
    const accountId = await ensurePiyesAccount(
      sender.id,
      sender.balance,
      sender.accountNumber,
    );
    const receiverAccountId = await ensurePiyesAccount(
      receiver.id,
      receiver.balance,
      receiver.accountNumber,
    );

    // Gestion description : chaîne vide si l'utilisateur n'a rien saisi (car colonne NOT NULL)
    let description = validated.description;
    if (
      description === undefined ||
      description === null ||
      description === ""
    ) {
      description = "";
    }

    const txCode = generateTxCode();
    const authCode = generateAuthCode();

    const { data: transaction, error: txError } = await supabase
      .from("Transaction")
      .insert({
        id: generateId(),
        type: TransactionType.TRANSFER,
        amount: amountCents,
        description,
        role: TransactionRole.PAYER,
        counterpartyName: receiver.name,
        userId: sender.id,
        accountId: accountId,
        external_id: txCode,
        auth_code: authCode,
        date: new Date().toISOString(),
      })
      .select()
      .single();

    if (txError) throw txError;

    const receiverTxId = generateId();
    const { error: receiverInsertError } = await supabase
      .from("Transaction")
      .insert({
        id: receiverTxId,
        type: TransactionType.TRANSFER,
        amount: amountCents,
        description: validated.description || "",
        role: TransactionRole.RECEIVER,
        counterpartyName: sender.name,
        userId: receiver.id,
        accountId: receiverAccountId,
        external_id: txCode,
        auth_code: authCode,
        date: new Date().toISOString(),
      });

    if (receiverInsertError) {
      console.error(
        "Failed to insert receiver transaction:",
        receiverInsertError,
      );
      // Rollback : supprimer la transaction PAYER déjà insérée
      await supabase.from("Transaction").delete().eq("id", transaction.id);
      throw new Error(
        "Échec de l’enregistrement de la transaction pour le destinataire",
      );
    }

    // Update balances
    await supabase
      .from("User")
      .update({
        balance: sender.balance - amountCents,
        updatedAt: new Date().toISOString(),
      })
      .eq("id", sender.id);
    await supabase
      .from("Account")
      .update({ balance: sender.balance - amountCents })
      .eq("userId", sender.id)
      .eq("provider", "piyes");

    await supabase
      .from("User")
      .update({
        balance: receiver.balance + amountCents,
        updatedAt: new Date().toISOString(),
      })
      .eq("id", receiver.id);
    await supabase
      .from("Account")
      .update({ balance: receiver.balance + amountCents })
      .eq("userId", receiver.id)
      .eq("provider", "piyes");

    // Notifications
    await supabase.from("Notification").insert({
      id: generateId(),
      userId: receiver.id,
      type: "transfer_received",
      title: "transfer_received",
      body: "transfer_received.body",
      amount: validated.amount.toString(),
      data: { name: sender.name, amount: validated.amount },
      isRead: false,
      targetId: receiverTxId,
      route: "/history",
      timestamp: new Date().toISOString(),
    });

    await supabase.from("Notification").insert({
      id: generateId(),
      userId: sender.id,
      type: "transfer_out",
      title: "transfer_out",
      body: "transfer_out.body",
      amount: validated.amount.toString(),
      data: { name: receiver.name, amount: validated.amount },
      isRead: false,
      targetId: transaction.id,
      route: "/history",
      timestamp: new Date().toISOString(),
    });

    // Contacts update
    const now = new Date().toISOString();
    const { data: existingContact } = await supabase
      .from("Contact")
      .select("id")
      .eq("userId", sender.id)
      .eq("contactUserId", receiver.id)
      .maybeSingle();
    const contactData = {
      userId: sender.id,
      contactUserId: receiver.id,
      name: receiver.name,
      tag: receiver.tag,
      phone: receiver.phone,
      email: receiver.email,
      lastTransactionDate: now,
      isVerified: true,
    };
    if (existingContact) {
      await supabase
        .from("Contact")
        .update(contactData)
        .eq("id", existingContact.id);
    } else {
      await supabase.from("Contact").insert({
        ...contactData,
        id: crypto.randomUUID(),
        createdAt: now,
        isFavorite: false,
      });
    }

    const { data: receiverExistingContact } = await supabase
      .from("Contact")
      .select("id")
      .eq("userId", receiver.id)
      .eq("contactUserId", sender.id)
      .maybeSingle();
    const receiverContactData = {
      userId: receiver.id,
      contactUserId: sender.id,
      name: sender.name,
      tag: sender.tag,
      phone: sender.phone,
      email: sender.email,
      lastTransactionDate: now,
      isVerified: true,
    };
    if (receiverExistingContact) {
      await supabase
        .from("Contact")
        .update(receiverContactData)
        .eq("id", receiverExistingContact.id);
    } else {
      await supabase.from("Contact").insert({
        ...receiverContactData,
        id: crypto.randomUUID(),
        createdAt: now,
        isFavorite: false,
      });
    }

    // Scheduled reminder handling
    const schedulerId = req.body.schedulerId;
    if (schedulerId) {
      const paidAt = new Date().toISOString();
      const { data: originalSchedule, error: fetchError } = await supabase
        .from("ScheduledPayment")
        .select("qrToken, amount")
        .eq("id", schedulerId)
        .single();
      if (fetchError) {
        console.error("Failed to fetch original schedule:", fetchError);
      }
      await supabase
        .from("ScheduledPayment")
        .update({ status: "paid", paidAt, updatedAt: paidAt })
        .eq("id", schedulerId);
      if (originalSchedule?.qrToken) {
        await supabase
          .from("ScheduledPayment")
          .update({ status: "paid", paidAt, updatedAt: paidAt })
          .eq("qrToken", originalSchedule.qrToken)
          .eq("type", "incoming")
          .eq("status", "confirmed");
      } else {
        await supabase
          .from("ScheduledPayment")
          .update({ status: "paid", paidAt, updatedAt: paidAt })
          .eq("payerUserId", sender.id)
          .eq("receiverUserId", receiver.id)
          .eq("type", "incoming")
          .eq("status", "confirmed")
          .eq("amount", amountCents);
      }
      await supabase.from("Notification").insert({
        id: generateId(),
        userId: receiver.id,
        type: "scheduled_confirmed",
        title: "scheduled_confirmed",
        body: "scheduled_confirmed.body",
        amount: validated.amount.toString(),
        data: { name: sender.name, amount: validated.amount },
        isRead: false,
        targetId: schedulerId,
        route: "/scheduler?tab=outgoing",
        timestamp: paidAt,
      });
    }

    const nameParts = receiver.name.trim().split(/\s+/);
    const recipientInitials =
      nameParts.length > 1
        ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
        : nameParts[0].substring(0, 2).toUpperCase();

    res.json({
      ...transaction,
      recipientId: receiver.id,
      recipientName: receiver.name,
      recipientAvatarUrl: receiver.avatarUrl,
      recipientInitials,
    });
  } catch (error: any) {
    console.error("Transfer error:", error);
    res
      .status(400)
      .json({ error: { message: error.message || "Transfer failed" } });
  }
});

// 2. RECHARGE (unchanged, no notification)
router.post("/recharge", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const validated = rechargeSchema.parse(req.body);
    const amountCents = Math.round(validated.amount * 100);

    const { data: account, error: accError } = await supabase
      .from("Account")
      .select("*")
      .eq("id", validated.accountId)
      .eq("userId", userId)
      .single();
    if (accError || !account) throw new Error("Compte de paiement introuvable");

    if (account.balance < amountCents) {
      return res.status(400).json({
        error: {
          message: "Transaction refusée : solde insuffisant",
          code: "INSUFFICIENT_BALANCE",
        },
      });
    }

    const { data: user } = await supabase
      .from("User")
      .select("*")
      .eq("id", userId)
      .single();
    if (!user) throw new Error("Utilisateur introuvable");
    console.log(`[TEST MODE] PIN bypass for recharge user ${userId}`);

    const txCode = generateTxCode();
    const authCode = generateAuthCode();

    const { data: transaction, error: txError } = await supabase
      .from("Transaction")
      .insert({
        id: generateId(),
        type: TransactionType.RECHARGE,
        amount: amountCents,
        description: `Recharge ${validated.operatorId} pour ${validated.phoneNumber}`,
        role: TransactionRole.PAYER,
        counterpartyName: validated.operatorId,
        userId: userId,
        accountId: account.id,
        external_id: txCode,
        auth_code: authCode,
        date: new Date().toISOString(),
      })
      .select()
      .single();
    if (txError) throw txError;

    const newAccountBalance = account.balance - amountCents;
    await supabase
      .from("Account")
      .update({ balance: newAccountBalance })
      .eq("id", account.id);
    if (account.provider === "piyes") {
      await supabase
        .from("User")
        .update({ balance: newAccountBalance })
        .eq("id", userId);
    }

    res.json(transaction);
  } catch (error: any) {
    res
      .status(400)
      .json({ error: { message: error.message || "Recharge failed" } });
  }
});

// 3. DEPOSIT
router.post("/deposit", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const validated = depositWithdrawSchema.parse(req.body);
    const amountCents = Math.round(validated.amount * 100);

    const { data: user } = await supabase
      .from("User")
      .select("balance")
      .eq("id", userId)
      .single();
    if (!user) throw new Error("User not found");

    const { data: userAccount } = await supabase
      .from("Account")
      .select("id")
      .eq("userId", userId)
      .eq("provider", "piyes")
      .single();
    const accountId = userAccount?.id || "piyes-main";

    // MonCash logic (unchanged)
    if (validated.accountId) {
      const { data: sourceAccount } = await supabase
        .from("Account")
        .select("*")
        .eq("id", validated.accountId)
        .eq("userId", userId)
        .single();
      if (sourceAccount?.provider === "moncash") {
        try {
          const { moncashService } =
            await import("../services/moncashService.js");
          const orderId = generateId();
          const redirectUrl = await moncashService.createPayment(
            validated.amount,
            orderId,
          );
          await supabase.from("Transaction").insert({
            id: orderId,
            type: TransactionType.DEPOSIT,
            amount: amountCents,
            description: "Dépôt MonCash (En attente)",
            role: TransactionRole.RECEIVER,
            counterpartyName: "MonCash",
            userId: userId,
            accountId: accountId,
            status: "PENDING",
            date: new Date().toISOString(),
          });
          return res.json({ redirectUrl, orderId });
        } catch (error: any) {
          return res.status(400).json({
            error: {
              message: error.message || "MonCash initialization failed",
            },
          });
        }
      }
    }

    const txCode = generateTxCode();
    const authCode = generateAuthCode();
    const { data: transaction, error: txError } = await supabase
      .from("Transaction")
      .insert({
        id: generateId(),
        type: TransactionType.DEPOSIT,
        amount: amountCents,
        description: "Dépôt sur compte",
        role: TransactionRole.RECEIVER,
        counterpartyName: "piYès Bank",
        userId: userId,
        accountId: accountId,
        external_id: txCode,
        auth_code: authCode,
        date: new Date().toISOString(),
      })
      .select()
      .single();
    if (txError) throw txError;

    const newBalance = user.balance + amountCents;
    await supabase
      .from("User")
      .update({ balance: newBalance })
      .eq("id", userId);
    await supabase
      .from("Account")
      .update({ balance: newBalance })
      .eq("userId", userId)
      .eq("provider", "piyes");

    // Create notification for deposit
    const { error: notifError } = await supabase.from("Notification").insert({
      id: generateId(),
      userId: userId,
      type: "deposit_success",
      title: "deposit_success",
      body: "deposit_success.body",
      amount: validated.amount.toString(),
      data: { name: "piYès Bank", amount: validated.amount, currency: "HTG" },
      isRead: false,
      targetId: transaction.id,
      route: "/history",
      timestamp: new Date().toISOString(),
    });

    if (notifError) {
      console.error("Deposit notification error:", notifError);
    }

    res.json(transaction);
  } catch (error: any) {
    res
      .status(400)
      .json({ error: { message: error.message || "Deposit failed" } });
  }
});

// 4. WITHDRAW
router.post("/withdraw", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const validated = depositWithdrawSchema.parse(req.body);
    const amountCents = Math.round(validated.amount * 100);

    const { data: user } = await supabase
      .from("User")
      .select("*")
      .eq("id", userId)
      .single();
    if (!user) throw new Error("User not found");

    if (user.balance < amountCents) throw new Error("Insufficient balance");

    const { data: userAccount } = await supabase
      .from("Account")
      .select("id")
      .eq("userId", userId)
      .eq("provider", "piyes")
      .single();
    const accountId = userAccount?.id || "piyes-main";

    // MonCash logic
    if (validated.accountId) {
      const { data: destAccount } = await supabase
        .from("Account")
        .select("*")
        .eq("id", validated.accountId)
        .eq("userId", userId)
        .single();
      if (destAccount?.provider === "moncash") {
        try {
          const { moncashService } =
            await import("../services/moncashService.js");
          const merchantBalance = await moncashService.getPrefundedBalance();
          if (merchantBalance < validated.amount) {
            throw new Error(
              "Service temporairement indisponible (Solde marchand insuffisant)",
            );
          }
          const reference = generateId();
          const result = await moncashService.transfer(
            validated.amount,
            destAccount.accountNumber,
            reference,
          );

          const txCode = generateTxCode();
          const authCode = generateAuthCode();
          const { data: transaction, error: txError } = await supabase
            .from("Transaction")
            .insert({
              id: generateId(),
              type: TransactionType.WITHDRAW,
              amount: amountCents,
              description: "Retrait vers MonCash",
              role: TransactionRole.PAYER,
              counterpartyName: "MonCash",
              userId: userId,
              accountId: accountId,
              external_id: txCode,
              auth_code: authCode,
              moncashTransactionId: result.transaction_id || reference,
              status: "COMPLETED",
              date: new Date().toISOString(),
            })
            .select()
            .single();
          if (txError) throw txError;

          const newBalance = user.balance - amountCents;
          await supabase
            .from("User")
            .update({ balance: newBalance })
            .eq("id", userId);
          await supabase
            .from("Account")
            .update({ balance: newBalance })
            .eq("userId", userId)
            .eq("provider", "piyes");

          await supabase.from("Notification").insert({
            id: generateId(),
            userId: userId,
            type: "withdraw_success",
            title: "withdraw_success",
            body: "withdraw_success.body",
            amount: validated.amount.toString(),
            data: { name: "MonCash", amount: validated.amount },
            isRead: false,
            targetId: transaction.id,
            route: "/history",
            timestamp: new Date().toISOString(),
          });
          return res.json(transaction);
        } catch (error: any) {
          if (error.message === "Maximum Account Balance") {
            return res.status(400).json({
              error: {
                message:
                  "Désolé, votre compte MonCash a atteint son plafond légal. Veuillez vider votre compte MonCash avant de demander un retrait piYès.",
                code: "MONCASH_LIMIT_REACHED",
              },
            });
          }
          return res.status(400).json({
            error: { message: error.message || "MonCash withdrawal failed" },
          });
        }
      }
    }

    // Standard withdrawal
    const txCode = generateTxCode();
    const authCode = generateAuthCode();
    const { data: transaction, error: txError } = await supabase
      .from("Transaction")
      .insert({
        id: generateId(),
        type: TransactionType.WITHDRAW,
        amount: amountCents,
        description: "Retrait de fonds",
        role: TransactionRole.PAYER,
        counterpartyName: "piYès Bank",
        userId: userId,
        accountId: accountId,
        external_id: txCode,
        auth_code: authCode,
        date: new Date().toISOString(),
      })
      .select()
      .single();
    if (txError) throw txError;

    const newBalance = user.balance - amountCents;
    await supabase
      .from("User")
      .update({ balance: newBalance })
      .eq("id", userId);
    await supabase
      .from("Account")
      .update({ balance: newBalance })
      .eq("userId", userId)
      .eq("provider", "piyes");

    await supabase.from("Notification").insert({
      id: generateId(),
      userId: userId,
      type: "withdraw_success",
      title: "withdraw_success",
      body: "withdraw_success.body",
      amount: validated.amount.toString(),
      data: { name: "piYès Bank", amount: validated.amount },
      isRead: false,
      targetId: transaction.id,
      route: "/history",
      timestamp: new Date().toISOString(),
    });

    res.json(transaction);
  } catch (error: any) {
    res
      .status(400)
      .json({ error: { message: error.message || "Withdraw failed" } });
  }
});

// 5. REQUEST PAYMENT (unchanged)
router.post("/request", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const validated = requestPaymentSchema.parse(req.body);
    const { data: sender } = await supabase
      .from("User")
      .select("name,id")
      .eq("id", userId)
      .single();
    if (!sender) throw new Error("User not found");

    if (validated.payer) {
      const { data: payer } = await supabase
        .from("User")
        .select("id")
        .or(`tag.eq.${validated.payer},accountNumber.eq.${validated.payer}`)
        .single();
      if (payer) {
        await supabase.from("Notification").insert({
          id: generateId(),
          userId: payer.id,
          type: "request",
          title: "Demande de paiement",
          body: `${sender.name} vous demande ${validated.amount} HTG.`,
          amount: validated.amount.toString(),
          isRead: false,
          targetId: sender.id,
          route: "/pix",
          timestamp: new Date().toISOString(),
        });
      }
    }

    const { data: user } = await supabase
      .from("User")
      .select("tag, phone, email")
      .eq("id", userId)
      .single();
    const to =
      user?.tag?.replace("@", "") || user?.phone || user?.email || userId;
    const type = user?.tag
      ? "tag"
      : user?.phone
        ? "phone"
        : user?.email
          ? "email"
          : "id";
    const paymentLink = `https://piyes.ht/pay?to=${encodeURIComponent(to)}&type=${type}&amount=${validated.amount}`;
    res.json({
      success: true,
      message: "Payment request created",
      paymentLink,
    });
  } catch (error: any) {
    res
      .status(400)
      .json({ error: { message: error.message || "Request failed" } });
  }
});

// 6. SCHEDULE PAYMENT (unchanged)
router.post("/schedule", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const validated = schedulePaymentSchema.parse(req.body);
    const amountCents = Math.round(validated.amount * 100);
    const { data: scheduled, error } = await supabase
      .from("ScheduledPayment")
      .insert({
        userId,
        title: validated.title || `Payment to ${validated.counterparty}`,
        counterparty: validated.counterparty,
        amount: amountCents,
        dueDate: new Date(validated.dueDate),
        type: validated.type,
        frequency: validated.frequency,
        status: "pending",
      })
      .select()
      .single();
    if (error) throw error;
    res.json(scheduled);
  } catch (error: any) {
    res
      .status(400)
      .json({ error: { message: error.message || "Scheduling failed" } });
  }
});

// 7. QR SCAN / PAY (unchanged except notification)
router.post("/scan", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { qrData, pin, amount } = req.body;
    const data = typeof qrData === "string" ? JSON.parse(qrData) : qrData;
    if (data.expiry && Date.now() > data.expiry)
      return res.status(400).json({ error: "QR Code expired" });

    const receiverId = data.id;
    const receiverTag = data.tag;
    const receiverPhone = data.phone;
    const receiverEmail = data.email;
    const paymentAmount = amount || data.amount;
    if (!paymentAmount)
      return res.status(400).json({ error: "Amount is required" });
    const amountCents = Math.round(paymentAmount * 100);

    const { data: sender } = await supabase
      .from("User")
      .select("*")
      .eq("id", userId)
      .single();
    if (!sender) throw new Error("User not found");
    console.log(`[TEST MODE] PIN bypass for user ${sender.id}`);
    if (sender.balance < amountCents) throw new Error("Insufficient balance");

    let receiver = null;
    if (receiverId) {
      const { data } = await supabase
        .from("User")
        .select("*")
        .eq("id", receiverId)
        .maybeSingle();
      receiver = data;
    }
    if (!receiver && receiverTag) {
      const { data } = await supabase
        .from("User")
        .select("*")
        .eq("tag", receiverTag)
        .maybeSingle();
      receiver = data;
    }
    if (!receiver && receiverPhone) {
      const { data } = await supabase
        .from("User")
        .select("*")
        .eq("phone", receiverPhone)
        .maybeSingle();
      receiver = data;
    }
    if (!receiver && receiverEmail) {
      const { data } = await supabase
        .from("User")
        .select("*")
        .eq("email", receiverEmail)
        .maybeSingle();
      receiver = data;
    }
    if (!receiver) throw new Error("Receiver not found");

    const newSenderBalance = sender.balance - amountCents;
    const newReceiverBalance = receiver.balance + amountCents;

    const { data: senderAccount } = await supabase
      .from("Account")
      .select("id")
      .eq("userId", sender.id)
      .eq("provider", "piyes")
      .single();
    const accountId = senderAccount?.id || "piyes-main";

    let description = req.body.description;
    if (
      description === undefined ||
      description === null ||
      description === ""
    ) {
      description = "";
    }

    const { data: receiverAccount } = await supabase
      .from("Account")
      .select("id")
      .eq("userId", receiver.id)
      .eq("provider", "piyes")
      .single();
    const receiverAccountId = receiverAccount?.id || "piyes-main";

    const txCode = generateTxCode();
    const authCode = generateAuthCode();
    // Insertion de la transaction PAYER
    const { data: transaction, error: payerError } = await supabase
      .from("Transaction")
      .insert({
        id: generateId(),
        type: TransactionType.TRANSFER,
        amount: amountCents,
        description: "",
        role: TransactionRole.PAYER,
        counterpartyName: receiver.name,
        userId: sender.id,
        accountId: accountId,
        external_id: txCode,
        auth_code: authCode,
        date: new Date().toISOString(),
      })
      .select()
      .single();

    if (payerError) {
      console.error("[SCAN] Failed to insert payer transaction:", payerError);
      throw payerError;
    }

    // Insertion de la transaction RECEIVER avec vérification d'erreur
    const { error: receiverError } = await supabase.from("Transaction").insert({
      id: generateId(),
      type: TransactionType.TRANSFER,
      amount: amountCents,
      description: "Paiement par QR Code",
      role: TransactionRole.RECEIVER,
      counterpartyName: sender.name,
      userId: receiver.id,
      accountId: receiverAccountId,
      external_id: txCode,
      auth_code: authCode,
      date: new Date().toISOString(),
    });

    if (receiverError) {
      console.error(
        "[SCAN] Failed to insert receiver transaction:",
        receiverError,
      );
      // ROLLBACK : supprimer la transaction PAYER déjà insérée
      await supabase.from("Transaction").delete().eq("id", transaction.id);
      throw receiverError;
    }

    await supabase
      .from("User")
      .update({ balance: newSenderBalance })
      .eq("id", sender.id);
    await supabase
      .from("Account")
      .update({ balance: newSenderBalance })
      .eq("userId", sender.id)
      .eq("provider", "piyes");

    await supabase
      .from("User")
      .update({ balance: newReceiverBalance })
      .eq("id", receiver.id);
    await supabase
      .from("Account")
      .update({ balance: newReceiverBalance })
      .eq("userId", receiver.id)
      .eq("provider", "piyes");

    // Notification for receiver
    await supabase.from("Notification").insert({
      id: generateId(),
      userId: receiver.id,
      type: "transfer_received",
      title: "transfer_received",
      body: "transfer_received.body",
      amount: paymentAmount.toString(),
      data: { name: sender.name, amount: paymentAmount },
      isRead: false,
      targetId: transaction?.id,
      route: "/history",
      timestamp: new Date().toISOString(),
    });

    // Update contacts (simplified)
    const now = new Date().toISOString();
    const { data: existingContact } = await supabase
      .from("Contact")
      .select("id")
      .eq("userId", sender.id)
      .eq("contactUserId", receiver.id)
      .maybeSingle();
    const contactData = {
      userId: sender.id,
      contactUserId: receiver.id,
      name: receiver.name,
      tag: receiver.tag,
      phone: receiver.phone,
      email: receiver.email,
      lastTransactionDate: now,
      isVerified: true,
    };
    if (existingContact) {
      await supabase
        .from("Contact")
        .update(contactData)
        .eq("id", existingContact.id);
    } else {
      await supabase.from("Contact").insert({
        ...contactData,
        id: crypto.randomUUID(),
        createdAt: now,
        isFavorite: false,
      });
    }

    res.json(transaction);
  } catch (error: any) {
    res
      .status(400)
      .json({ error: { message: error.message || "QR Payment failed" } });
  }
});

// 8. HISTORY (unchanged)
router.get("/", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const { accountId, counterpartyName, limit = 50, offset = 0 } = req.query;
    let query = supabase
      .from("Transaction")
      .select("*")
      .eq("userId", userId)
      .order("date", { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);
    if (accountId) query = query.eq("accountId", accountId);
    if (counterpartyName)
      query = query.eq("counterpartyName", counterpartyName);
    const { data: transactions } = await query;
    res.json(
      (transactions || []).map((tx: any) => ({
        ...tx,
        amount: tx.amount / 100,
      })),
    );
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

// Helper to mask account numbers
const maskAccountNumber = (acc: string) => {
  if (!acc) return "••••";
  const lastPart = acc.length > 4 ? acc.slice(-4) : acc;
  return `••••${lastPart}`;
};

// 9. RECEIPT (unchanged)
router.get("/receipts/:id", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { data: tx } = await supabase
      .from("Transaction")
      .select("*")
      .eq("id", req.params.id)
      .single();
    if (!tx) return res.status(404).json({ error: "Transaction not found" });
    const { data: account } = await supabase
      .from("Account")
      .select("*, user:User(*)")
      .eq("id", tx.accountId)
      .single();
    let counterpartyAccount = null,
      counterpartyUser = null;
    if (tx.type === TransactionType.TRANSFER && tx.external_id) {
      const { data: otherTx } = await supabase
        .from("Transaction")
        .select("accountId")
        .eq("external_id", tx.external_id)
        .neq("id", tx.id)
        .single();
      if (otherTx) {
        const { data: otherAccount } = await supabase
          .from("Account")
          .select("*, user:User(*)")
          .eq("id", otherTx.accountId)
          .single();
        if (otherAccount) {
          counterpartyAccount = otherAccount;
          counterpartyUser = otherAccount.user;
        }
      }
    }
    const myAccount = account,
      myUser = account?.user;
    const senderAccount =
      tx.role === TransactionRole.PAYER ? myAccount : counterpartyAccount;
    const senderUser =
      tx.role === TransactionRole.PAYER ? myUser : counterpartyUser;
    const receiverAccount =
      tx.role === TransactionRole.RECEIVER ? myAccount : counterpartyAccount;
    const receiverUser =
      tx.role === TransactionRole.RECEIVER ? myUser : counterpartyUser;
    const receipt = {
      id: tx.id,
      amount: tx.amount / 100,
      status: tx.status || "success",
      date: tx.date,
      receipt_type: tx.type,
      receipt_subtype: tx.description?.includes("Transfert via clé")
        ? "P2P_KEY"
        : tx.description?.includes("Rappel de transfert")
          ? "P2P_SCHEDULE"
          : tx.description?.includes("Paiement par lien")
            ? "P2P_LINK"
            : tx.description?.includes("QR Payment")
              ? "P2P_QR"
              : tx.description?.includes("Recharge")
                ? "RECHARGE"
                : tx.description?.includes("Dépôt sur compte")
                  ? "DEPOSIT"
                  : tx.description?.includes("Retrait")
                    ? "WITHDRAW"
                    : tx.description?.includes("Transfert inter-bancaire")
                      ? "INTERBANK"
                      : tx.description?.includes("Transfert international")
                        ? "INTERNATIONAL"
                        : undefined,
      external_id: tx.external_id,
      auth_code: tx.auth_code,
      transaction_id: tx.id,
      moncashTransactionId: tx.moncashTransactionId,
      counterparty: tx.counterpartyName,
      description: tx.description,
      sender: {
        name:
          senderUser?.name ||
          (tx.role === TransactionRole.PAYER ? "Moi" : tx.counterpartyName),
        masked_account: senderAccount?.accountNumber
          ? maskAccountNumber(senderAccount.accountNumber)
          : undefined,
        idNumber: senderUser?.idNumber,
        bank:
          senderAccount?.provider === "piyes"
            ? "piYès"
            : senderAccount?.label || "piYès",
      },
      receiver: {
        name:
          receiverUser?.name ||
          (tx.role === TransactionRole.RECEIVER ? "Moi" : tx.counterpartyName),
        masked_account: receiverAccount?.accountNumber
          ? maskAccountNumber(receiverAccount.accountNumber)
          : undefined,
        idNumber: receiverUser?.idNumber,
        bank:
          receiverAccount?.provider === "piyes"
            ? "piYès"
            : receiverAccount?.label || "piYès",
      },
    };
    res.json(receipt);
  } catch (error) {
    console.error("Receipt error:", error);
    res.status(500).json({ error: "Failed to fetch receipt" });
  }
});

// 10. INTER-BANK TRANSFER (unchanged)
router.post(
  "/inter-bank-transfer",
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const validated = interBankTransferSchema.parse(req.body);
      const amountCents = Math.round(validated.amount * 100);
      const { data: user } = await supabase
        .from("User")
        .select("*")
        .eq("id", userId)
        .single();
      if (!user) throw new Error("User not found");
      let sourceAcc: any = null;
      if (validated.sourceId === "piyes-main") {
        const { data } = await supabase
          .from("Account")
          .select("*")
          .eq("userId", userId)
          .eq("provider", "piyes")
          .maybeSingle();
        if (data) sourceAcc = data;
        else
          sourceAcc = {
            id: "piyes-main",
            userId,
            provider: "piyes",
            label: "piYès",
            balance: user.balance,
            accountNumber: user.accountNumber,
          };
      } else {
        const { data } = await supabase
          .from("Account")
          .select("*")
          .eq("id", validated.sourceId)
          .eq("userId", userId)
          .single();
        sourceAcc = data;
      }
      let destAcc: any = null;
      if (validated.destId === "piyes-main") {
        const { data } = await supabase
          .from("Account")
          .select("*")
          .eq("userId", userId)
          .eq("provider", "piyes")
          .maybeSingle();
        if (data) destAcc = data;
        else
          destAcc = {
            id: "piyes-main",
            userId,
            provider: "piyes",
            label: "piYès",
            balance: user.balance,
            accountNumber: user.accountNumber,
          };
      } else {
        const { data } = await supabase
          .from("Account")
          .select("*")
          .eq("id", validated.destId)
          .eq("userId", userId)
          .single();
        destAcc = data;
      }
      if (!sourceAcc) throw new Error("Source account not found");
      if (!destAcc) throw new Error("Destination account not found");
      if (sourceAcc.provider === "piyes") {
        if (user.balance < amountCents) throw new Error("Insufficient balance");
      }
      const txCode = generateTxCode();
      const authCode = generateAuthCode();

      // Déterminer le rôle de l'utilisateur selon le sens du transfert
      const isUserSource = sourceAcc.provider === "piyes";
      const userRole = isUserSource
        ? TransactionRole.PAYER
        : TransactionRole.RECEIVER;
      const counterpartyRole = isUserSource
        ? TransactionRole.RECEIVER
        : TransactionRole.PAYER;

      // Transaction pour l'utilisateur (compte piYès)
      const userTxId = generateId();
      const { data: userTx, error: userTxError } = await supabase
        .from("Transaction")
        .insert({
          id: userTxId,
          type: TransactionType.INTERBANK_OUT,
          amount: amountCents,
          description:
            validated.note ||
            `Transfert inter-bancaire: ${sourceAcc.label} ↔ ${destAcc.label}`,
          role: userRole,
          counterpartyName: isUserSource ? destAcc.label : sourceAcc.label,
          userId: userId,
          accountId: isUserSource ? sourceAcc.id : destAcc.id,
          external_id: txCode,
          auth_code: authCode,
          date: new Date().toISOString(),
        })
        .select()
        .single();

      if (userTxError) throw userTxError;

      // Transaction pour l'autre compte (externe)
      const otherUserId = isUserSource ? destAcc.userId : sourceAcc.userId;
      if (otherUserId) {
        await supabase.from("Transaction").insert({
          id: generateId(),
          type: TransactionType.INTERBANK_OUT,
          amount: amountCents,
          description:
            validated.note ||
            `Transfert inter-bancaire: ${sourceAcc.label} ↔ ${destAcc.label}`,
          role: counterpartyRole,
          counterpartyName: isUserSource ? sourceAcc.label : destAcc.label,
          userId: otherUserId,
          accountId: isUserSource ? destAcc.id : sourceAcc.id,
          external_id: txCode,
          auth_code: authCode,
          date: new Date().toISOString(),
        });
      }
      res.json(userTx);
    } catch (error: any) {
      console.error("Inter-bank transfer error:", error);
      res
        .status(400)
        .json({ error: { message: error.message || "Transfer failed" } });
    }
  },
);

// 11. MONCASH CONFIRMATION (unchanged)
router.post(
  "/moncash/confirm",
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const { transactionId, orderId } = req.body;
      if (!transactionId)
        return res.status(400).json({ error: "Missing transactionId" });
      const { moncashService } = await import("../services/moncashService.js");
      const result =
        await moncashService.retrieveTransactionPayment(transactionId);
      if (result.payment.message === "successful") {
        const amountCents = Math.round(result.payment.cost * 100);
        const { data: user } = await supabase
          .from("User")
          .select("balance")
          .eq("id", userId)
          .single();
        if (!user) throw new Error("User not found");
        const newBalance = user.balance + amountCents;
        await supabase
          .from("User")
          .update({ balance: newBalance })
          .eq("id", userId);
        await supabase
          .from("Account")
          .update({ balance: newBalance })
          .eq("userId", userId)
          .eq("provider", "piyes");
        const txCode = generateTxCode();
        const authCode = generateAuthCode();
        let txId = generateId();
        if (orderId) {
          const { data: existingTx } = await supabase
            .from("Transaction")
            .select("id")
            .eq("id", orderId)
            .single();
          if (existingTx) txId = orderId;
        }
        const { data: transaction, error: txError } = await supabase
          .from("Transaction")
          .upsert({
            id: txId,
            type: TransactionType.DEPOSIT,
            amount: amountCents,
            description: "Dépôt MonCash",
            role: TransactionRole.RECEIVER,
            counterpartyName: "MonCash",
            userId: userId,
            accountId: "piyes-main",
            external_id: txCode,
            auth_code: authCode,
            moncashTransactionId: transactionId,
            status: "COMPLETED",
            date: new Date().toISOString(),
          })
          .select()
          .single();
        if (txError) throw txError;
        return res.json(transaction);
      } else {
        return res
          .status(400)
          .json({ error: "Payment failed or not successful" });
      }
    } catch (error: any) {
      console.error("MonCash confirmation error:", error);
      res
        .status(400)
        .json({ error: { message: error.message || "Confirmation failed" } });
    }
  },
);

// 12. REPORTS
router.get("/reports", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const { period = "month", from, to } = req.query;
    const now = new Date();
    let startDate: Date, prevStartDate: Date, prevEndDate: Date;
    if (period === "custom" && from && to) {
      startDate = new Date(from as string);
      const toDate = new Date(to as string);
      toDate.setHours(23, 59, 59, 999);
      const duration = toDate.getTime() - startDate.getTime();
      prevEndDate = new Date(startDate);
      prevStartDate = new Date(startDate.getTime() - duration);
      const { data: transactions } = await supabase
        .from("Transaction")
        .select("*")
        .eq("userId", userId)
        .gte("date", startDate.toISOString())
        .lte("date", toDate.toISOString())
        .order("date", { ascending: false });
      const { data: prevTransactions } = await supabase
        .from("Transaction")
        .select("amount, role")
        .eq("userId", userId)
        .gte("date", prevStartDate.toISOString())
        .lt("date", prevEndDate.toISOString());
      (req as any)._txs = transactions || [];
      (req as any)._prevTxs = prevTransactions || [];
    }
    switch (period) {
      case "3months":
        startDate = new Date(now.getFullYear(), now.getMonth() - 3, 1);
        prevStartDate = new Date(now.getFullYear(), now.getMonth() - 6, 1);
        prevEndDate = new Date(startDate);
        break;
      case "6months":
        startDate = new Date(now.getFullYear(), now.getMonth() - 6, 1);
        prevStartDate = new Date(now.getFullYear(), now.getMonth() - 12, 1);
        prevEndDate = new Date(startDate);
        break;
      case "year":
        startDate = new Date(now.getFullYear(), 0, 1);
        prevStartDate = new Date(now.getFullYear() - 1, 0, 1);
        prevEndDate = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        prevStartDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        prevEndDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }
    let txs: any[] = [],
      prevTxs: any[] = [];
    if ((req as any)._txs) {
      txs = (req as any)._txs;
      prevTxs = (req as any)._prevTxs;
    } else {
      const { data: transactions } = await supabase
        .from("Transaction")
        .select("*")
        .eq("userId", userId)
        .gte("date", startDate!.toISOString())
        .order("date", { ascending: false });
      const { data: prevTransactions } = await supabase
        .from("Transaction")
        .select("amount, role")
        .eq("userId", userId)
        .gte("date", prevStartDate!.toISOString())
        .lt("date", prevEndDate!.toISOString());
      txs = transactions || [];
      prevTxs = prevTransactions || [];
    }
    const received = txs.filter((t) => t.role === "RECEIVER");
    const sent = txs.filter((t) => t.role === "PAYER");
    const totalReceived = received.reduce((s, t) => s + t.amount, 0) / 100;
    const totalSent = sent.reduce((s, t) => s + t.amount, 0) / 100;
    const prevReceived =
      prevTxs
        .filter((t) => t.role === "RECEIVER")
        .reduce((s, t) => s + t.amount, 0) / 100;
    const prevSent =
      prevTxs
        .filter((t) => t.role === "PAYER")
        .reduce((s, t) => s + t.amount, 0) / 100;
    const senderMap = new Map<string, { amount: number; count: number }>();
    received.forEach((t) => {
      const existing = senderMap.get(t.counterpartyName) || {
        amount: 0,
        count: 0,
      };
      senderMap.set(t.counterpartyName, {
        amount: existing.amount + t.amount / 100,
        count: existing.count + 1,
      });
    });
    const topSenders = Array.from(senderMap.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
    const byHour = Array.from({ length: 24 }, (_, hour) => {
      const hourTxs = received.filter(
        (t) => new Date(t.date).getHours() === hour,
      );
      return {
        hour,
        amount: hourTxs.reduce((s, t) => s + t.amount / 100, 0),
        count: hourTxs.length,
      };
    });
    const typeMap = new Map<string, { amount: number; count: number }>();
    txs.forEach((t) => {
      const existing = typeMap.get(t.type) || { amount: 0, count: 0 };
      typeMap.set(t.type, {
        amount: existing.amount + t.amount / 100,
        count: existing.count + 1,
      });
    });
    const byType = Array.from(typeMap.entries()).map(([type, data]) => ({
      type,
      ...data,
    }));
    const senderCounts = Array.from(senderMap.values()).map((v) => v.count);
    const frequencyBreakdown = {
      once: senderCounts.filter((c) => c === 1).length,
      repeat: senderCounts.filter((c) => c >= 2 && c <= 4).length,
      frequent: senderCounts.filter((c) => c >= 5).length,
    };
    // Récupérer les transactions sortantes (PAYER) pour le calcul des frais
    const sentTransactions = txs.filter((t: any) => t.role === "PAYER");
    const totalFeesPaid = computeTotalFees(sentTransactions);

    // --- Calcul de l'économie vs banques traditionnelles ---
    // Basé sur la moyenne des frais de virement interbancaire SPIH (≈ 85 G. par transaction)
    const AVG_BANK_FEE = 85; // HTG par virement
    const sentInterbank = sent.filter((t: any) => t.type === "INTERBANK_OUT");
    const interbankCount = sentInterbank.length;
    const totalBankFeesIfTraditional = interbankCount * AVG_BANK_FEE;
    const totalInterbankFeesPaid = computeTotalFees(
      interbankCount > 0 ? sentInterbank : [],
    );
    const savingsVsBank = totalBankFeesIfTraditional - totalInterbankFeesPaid;

    // Simulation MonCash sur TOUTES les transactions sortantes concernées
    const moncashRelevantSent = sent.filter(
      (t: any) =>
        t.type === "TRANSFER" ||
        t.type === "DEPOSIT" ||
        t.type === "WITHDRAW" ||
        t.type === "INTERBANK_OUT",
    );
    const simulatedMoncashFees =
      computeSimulatedMoncashFees(moncashRelevantSent);
    // Frais piYès sur P2P = 0, donc économie = frais MonCash simulés
    const savingsVsMoncash = simulatedMoncashFees;

    res.json({
      period,
      totalReceived,
      totalSent,
      netBalance: totalReceived - totalSent,
      transactionCount: txs.length,
      receivedCount: received.length,
      sentCount: sent.length,
      previousPeriodReceived: prevReceived,
      previousPeriodSent: prevSent,
      totalBankFeesIfTraditional,
      simulatedMoncashFees,
      topSenders,
      byHour,
      byType,
      avgTransactionAmount:
        txs.length > 0 ? (totalReceived + totalSent) / txs.length : 0,
      totalFeesPaid,
      savingsVsBank,
      frequencyBreakdown,
      savingsVsMoncash,
    });
  } catch (error) {
    console.error("Reports error:", error);
    res.status(500).json({ error: "Failed to generate report" });
  }
});

// 13. INTERNATIONAL (unchanged)
router.post("/international", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const {
      amount,
      country,
      recipientName,
      method,
      methodInfo,
      currency,
      amountForeign,
      exchangeRate,
    } = req.body;
    if (!amount || !country || !recipientName || !method) {
      return res.status(400).json({
        error: {
          message: "Champs obligatoires manquants",
          code: "MISSING_FIELDS",
        },
      });
    }
    const { data: user } = await supabase
      .from("User")
      .select("*")
      .eq("id", userId)
      .single();
    if (!user) return res.status(404).json({ error: "User not found" });
    const amountCents = Math.round(parseFloat(amount) * 100);
    if (user.balance < amountCents) {
      return res.status(400).json({
        error: { message: "Solde insuffisant", code: "INSUFFICIENT_BALANCE" },
      });
    }
    const { v4: uuidv4 } = await import("uuid");
    const txId = uuidv4();
    const intlId = uuidv4();
    const authCode = Math.random().toString(36).substring(2, 10).toUpperCase();
    const externalId = `INTL-${Date.now()}`;
    const { data: transaction, error: txError } = await supabase
      .from("Transaction")
      .insert({
        id: txId,
        type: "INTERNATIONAL",
        amount: amountCents,
        description: `Transfert international vers ${country} — ${recipientName}`,
        role: "PAYER",
        counterpartyName: recipientName,
        userId,
        auth_code: authCode,
        external_id: externalId,
        date: new Date().toISOString(),
      })
      .select()
      .single();
    if (txError) throw txError;
    const feesCents = Math.round(amountCents * 0.01);
    await supabase.from("InternationalTransfer").insert({
      id: intlId,
      senderId: userId,
      recipientName,
      country,
      method,
      methodInfo: methodInfo || null,
      amountHTG: amountCents,
      currency: currency || "USD",
      amountForeign: Math.round((amountForeign || 0) * 100),
      fees: feesCents,
      exchangeRate: exchangeRate || null,
      status: "pending",
      transactionId: txId,
      authCode,
      externalId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const newBalance = user.balance - amountCents;
    await supabase
      .from("User")
      .update({ balance: newBalance })
      .eq("id", userId);
    await supabase
      .from("Account")
      .update({ balance: newBalance })
      .eq("userId", userId)
      .eq("provider", "piyes");
    res.json({
      id: txId,
      auth_code: authCode,
      external_id: externalId,
      amount: amountCents / 100,
      status: "pending",
    });
  } catch (error: any) {
    console.error("International transfer error:", error);
    res.status(400).json({
      error: { message: error.message || "Transfert international échoué" },
    });
  }
});

// 14. PRE-CHECK (unchanged)
router.get("/resolve/:key", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const key = decodeURIComponent(String(req.params.key)).trim();
    if (!key) return res.status(400).json({ error: "Clé requise" });
    let receiver: any = null;
    if (key.startsWith("@") || !key.includes("@")) {
      const tagValue = key.startsWith("@") ? key : `@${key}`;
      const { data } = await supabase
        .from("User")
        .select("id, name, tag, phone, email, avatarUrl")
        .ilike("tag", tagValue)
        .maybeSingle();
      if (data) receiver = data;
    }
    if (!receiver && key.includes("@") && key.includes(".")) {
      const { data } = await supabase
        .from("User")
        .select("id, name, tag, phone, email, avatarUrl")
        .ilike("email", key)
        .maybeSingle();
      if (data) receiver = data;
    }
    if (!receiver) {
      const { data } = await supabase
        .from("User")
        .select("id, name, tag, phone, email, avatarUrl")
        .eq("accountNumber", key)
        .maybeSingle();
      if (data) receiver = data;
    }
    if (!receiver) {
      let normalizedPhone = key;
      if (!normalizedPhone.startsWith("+"))
        normalizedPhone = normalizedPhone.startsWith("509")
          ? `+${normalizedPhone}`
          : `+509${normalizedPhone}`;
      const { data } = await supabase
        .from("User")
        .select("id, name, tag, phone, email, avatarUrl")
        .eq("phone", normalizedPhone)
        .maybeSingle();
      if (data) receiver = data;
    }
    if (!receiver) {
      const { data } = await supabase
        .from("User")
        .select("id, name, tag, phone, email, avatarUrl")
        .eq("id", key)
        .maybeSingle();
      if (data) receiver = data;
    }
    if (!receiver) {
      const { data: keyMatch } = await supabase
        .from("Key")
        .select("userId")
        .eq("value", key)
        .eq("isVerified", true)
        .maybeSingle();
      if (keyMatch) {
        const { data } = await supabase
          .from("User")
          .select("id, name, tag, phone, email, avatarUrl")
          .eq("id", keyMatch.userId)
          .single();
        receiver = data;
      }
    }
    if (!receiver) {
      return res.status(404).json({
        error: { message: "Destinataire introuvable", code: "NOT_FOUND" },
      });
    }
    const { data: receiverAccount } = await supabase
      .from("Account")
      .select("permission")
      .eq("userId", receiver.id)
      .eq("provider", "piyes")
      .maybeSingle();
    if (
      receiverAccount &&
      receiverAccount.permission !== null &&
      receiverAccount.permission !== "oui"
    ) {
      return res.status(403).json({
        error: {
          message:
            "Ce destinataire ne peut pas recevoir de paiements pour le moment",
          code: "PERMISSION_DENIED",
        },
      });
    }
    res.json({
      id: receiver.id,
      name: receiver.name,
      tag: receiver.tag,
      phone: receiver.phone,
      email: receiver.email,
      avatarUrl: receiver.avatarUrl,
    });
  } catch (e: any) {
    console.error("Resolve error:", e);
    res.status(500).json({ error: e.message });
  }
});

// 15. GET /transactions/balance-before?date=2025-01-01T00:00:00.000Z
router.get("/balance-before", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { date } = req.query;
    if (!date)
      return res.status(400).json({ error: "Date parameter required" });

    const targetDate = new Date(date as string);
    if (isNaN(targetDate.getTime())) {
      return res.status(400).json({ error: "Invalid date format" });
    }

    // Récupérer toutes les transactions AVANT cette date
    const { data: transactions } = await supabase
      .from("Transaction")
      .select("amount, role")
      .eq("userId", userId)
      .lt("date", targetDate.toISOString());

    // Calculer le solde
    let balance = 0;
    (transactions || []).forEach((tx: any) => {
      if (tx.role === "RECEIVER") {
        balance += tx.amount;
      } else if (tx.role === "PAYER") {
        balance -= tx.amount;
      }
    });

    res.json({ balance: balance / 100 });
  } catch (error) {
    console.error("Balance before error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
export default router;
