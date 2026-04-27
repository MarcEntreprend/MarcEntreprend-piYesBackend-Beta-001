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

    // TEST MODE MVP : PIN accepté sans vérification
    // TODO: décommenter la vérification bcrypt en production
    // if (!sender.pinHash) throw new Error('PIN not set');
    // const isPinValid = await bcrypt.compare(validated.pin, sender.pinHash);
    // if (!isPinValid) throw new Error('Invalid PIN');
    console.log(`[TEST MODE] PIN bypass for user ${sender.id}`);

    if (sender.balance < amountCents) {
      throw new Error("Insufficient balance");
    }

    // Find receiver by tag, ID, account number or secondary key
    let receiver = null;

    // 1. Try User table (id, tag, accountNumber) - Case-insensitive for tag
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
      // 2. Try Key table (secondary keys)
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

    if (!receiver) {
      throw new Error("Receiver not found");
    }

    if (receiver.id === sender.id) {
      throw new Error("Cannot transfer to yourself");
    }

    // Vérifier la permission du compte receiver avant de procéder
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

    // Fetch sender's piyes account ID
    const { data: senderAccount } = await supabase
      .from("Account")
      .select("id")
      .eq("userId", sender.id)
      .eq("provider", "piyes")
      .single();
    const accountId = senderAccount?.id || "piyes-main";

    // Create transaction records first to ensure they exist
    const txCode = generateTxCode();
    const authCode = generateAuthCode();
    console.log(
      `Processing transfer: sender=${sender.id}, receiver=${receiver.id}, pin_provided=${!!validated.pin}`,
    );

    const { data: transaction, error: txError } = await supabase
      .from("Transaction")
      .insert({
        id: generateId(),
        type: TransactionType.TRANSFER,
        amount: amountCents,
        description: validated.description || `Transfer to ${receiver.name}`,
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

    if (txError) {
      console.error("Failed to create sender transaction record:", txError);
      throw txError;
    }

    // Fetch receiver's piyes account ID
    const { data: receiverAccount } = await supabase
      .from("Account")
      .select("id")
      .eq("userId", receiver.id)
      .eq("provider", "piyes")
      .single();
    const receiverAccountId = receiverAccount?.id || "piyes-main";

    const receiverTxId = generateId();
    const { error: txError2 } = await supabase.from("Transaction").insert({
      id: receiverTxId,
      type: TransactionType.TRANSFER,
      amount: amountCents,
      description: validated.description || `Transfer from ${sender.name}`,
      role: TransactionRole.RECEIVER,
      counterpartyName: sender.name,
      userId: receiver.id,
      accountId: receiverAccountId,
      external_id: txCode,
      auth_code: authCode,
      date: new Date().toISOString(),
    });
    if (txError2)
      console.error("Failed to create receiver transaction record:", txError2);

    // Update balances
    const { error: decError } = await supabase
      .from("User")
      .update({
        balance: sender.balance - amountCents,
        updatedAt: new Date().toISOString(),
      })
      .eq("id", sender.id);
    if (decError) throw decError;

    // Sync Sender's piYès account balance
    await supabase
      .from("Account")
      .update({ balance: sender.balance - amountCents })
      .eq("userId", sender.id)
      .eq("provider", "piyes");

    const { error: incError } = await supabase
      .from("User")
      .update({
        balance: receiver.balance + amountCents,
        updatedAt: new Date().toISOString(),
      })
      .eq("id", receiver.id);
    if (incError) {
      console.error("Failed to increment receiver balance:", incError);
    }

    // Sync Receiver's piYès account balance
    await supabase
      .from("Account")
      .update({ balance: receiver.balance + amountCents })
      .eq("userId", receiver.id)
      .eq("provider", "piyes");

    // Create notification for receiver
    await supabase.from("Notification").insert({
      id: generateId(),
      userId: receiver.id,
      type: "transfer_received",
      title: "Transfert reçu",
      body: `Vous avez reçu ${validated.amount} HTG de ${sender.name}`,
      amount: validated.amount.toString(),
      isRead: false,
      targetId: receiverTxId,
      route: "/history",
      timestamp: new Date().toISOString(),
    });

    // Update or Create Contact for the sender
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

    // Mettre à jour lastTransactionDate côté receiver aussi (pour qu'il apparaisse dans ses récents)
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

    // Si paiement depuis un rappel scheduler → marquer comme payé des deux côtés
    const schedulerId = req.body.schedulerId;
    if (schedulerId) {
      const paidAt = new Date().toISOString();
      // Marquer côté payeur (outgoing)
      await supabase
        .from("ScheduledPayment")
        .update({ status: "paid", paidAt, updatedAt: paidAt })
        .eq("id", schedulerId);
      // Marquer côté receiver (chercher l'item incoming lié)
      await supabase
        .from("ScheduledPayment")
        .update({ status: "paid", paidAt, updatedAt: paidAt })
        .eq("payerUserId", sender.id)
        .eq("receiverUserId", receiver.id)
        .eq("type", "incoming")
        .eq("status", "confirmed");
      // Notif receiver : rappel payé
      await supabase.from("Notification").insert({
        id: generateId(),
        userId: receiver.id,
        type: "scheduled_confirmed",
        title: "Rappel payé !",
        body: `${sender.name} a effectué le paiement de ${validated.amount} G. prévu par le rappel.`,
        amount: validated.amount.toString(),
        isRead: false,
        targetId: schedulerId,
        route: "/scheduler?tab=outgoing",
        timestamp: paidAt,
      });
    }

    // TODO: Send push notification via FCM/OneSignal
    // sendPushNotification(receiver.id, 'Transfert reçu', `Vous avez reçu ${validated.amount} HTG de ${sender.name}`);

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

// 2. RECHARGE
router.post("/recharge", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const validated = rechargeSchema.parse(req.body);
    const amountCents = Math.round(validated.amount * 100);

    // 1. Fetch account and verify balance FIRST
    const { data: account, error: accError } = await supabase
      .from("Account")
      .select("*")
      .eq("id", validated.accountId)
      .eq("userId", userId)
      .single();

    if (accError || !account) {
      throw new Error("Compte de paiement introuvable");
    }

    if (account.balance < amountCents) {
      return res.status(400).json({
        error: {
          message: "Transaction refusée : solde insuffisant",
          code: "INSUFFICIENT_BALANCE",
        },
      });
    }

    // 2. Fetch user for PIN verification
    const { data: user } = await supabase
      .from("User")
      .select("*")
      .eq("id", userId)
      .single();
    if (!user) throw new Error("Utilisateur introuvable");

    // if (!user.pinHash) throw new Error('PIN non configuré');
    // const isPinValid = await bcrypt.compare(validated.pin, user.pinHash);
    // if (!isPinValid) throw new Error('PIN invalide');

    // TEST MODE MVP : PIN recharge bypassé
    // TODO: réactiver en production
    // if (!user.pinHash) throw new Error('PIN non configuré');
    // const isPinValid = await bcrypt.compare(validated.pin, user.pinHash);
    // if (!isPinValid) throw new Error('PIN invalide');
    console.log(`[TEST MODE] PIN bypass for recharge user ${userId}`);

    // 3. Execute transaction
    const txCode = generateTxCode();
    const authCode = generateAuthCode();

    // Create transaction record
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

    // Update balances
    const newAccountBalance = account.balance - amountCents;

    // Update the specific account
    const { error: updateAccError } = await supabase
      .from("Account")
      .update({
        balance: newAccountBalance,
        updatedAt: new Date().toISOString(),
      })
      .eq("id", account.id);

    if (updateAccError) throw updateAccError;

    // If it was the piyes account, also update the User table balance
    if (account.provider === "piyes") {
      await supabase
        .from("User")
        .update({
          balance: newAccountBalance,
          updatedAt: new Date().toISOString(),
        })
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

    // Fetch piyes account ID
    const { data: userAccount } = await supabase
      .from("Account")
      .select("id")
      .eq("userId", userId)
      .eq("provider", "piyes")
      .single();
    const accountId = userAccount?.id || "piyes-main";

    // MonCash specific logic
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

          // Create a pending transaction
          await supabase.from("Transaction").insert({
            id: orderId, // Use orderId as ID for tracking
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
          console.error("MonCash deposit init error:", error);
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
    await supabase.from("Notification").insert({
      id: generateId(),
      userId: userId,
      type: "transfer_received",
      title: "Dépôt réussi",
      body: `Votre dépôt de ${validated.amount} HTG a été complété.`,
      amount: validated.amount.toString(),
      isRead: false,
      targetId: transaction?.id,
      route: "/history",
      timestamp: new Date().toISOString(),
    });

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

    // if (!user.pinHash) throw new Error('PIN not set');
    // console.log(`Verifying PIN for withdraw, user ${user.id}. Hash exists: ${!!user.pinHash}`);
    // const isPinValid = await bcrypt.compare(validated.pin, user.pinHash);
    // console.log(`PIN verification result for withdraw, user ${user.id}: ${isPinValid}`);
    // if (!isPinValid) throw new Error('Invalid PIN');

    if (user.balance < amountCents) {
      throw new Error("Insufficient balance");
    }

    // Fetch piyes account ID
    const { data: userAccount } = await supabase
      .from("Account")
      .select("id")
      .eq("userId", userId)
      .eq("provider", "piyes")
      .single();
    const accountId = userAccount?.id || "piyes-main";

    // MonCash specific logic
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

          // 1. Check prefunded balance
          const merchantBalance = await moncashService.getPrefundedBalance();
          if (merchantBalance < validated.amount) {
            throw new Error(
              "Service temporairement indisponible (Solde marchand insuffisant)",
            );
          }

          // 2. Execute transfer
          const reference = generateId();
          const result = await moncashService.transfer(
            validated.amount,
            destAccount.accountNumber,
            reference,
          );

          // 3. Update balances and create transaction
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

          // Create notification for MonCash withdraw
          await supabase.from("Notification").insert({
            id: generateId(),
            userId: userId,
            type: "transfer_out",
            title: "Retrait réussi",
            body: `Votre retrait de ${validated.amount} HTG vers MonCash a été complété.`,
            amount: validated.amount.toString(),
            isRead: false,
            targetId: transaction?.id,
            route: "/history",
            timestamp: new Date().toISOString(),
          });

          return res.json(transaction);
        } catch (error: any) {
          console.error("MonCash withdraw error:", error);
          // Handle 403 specifically as requested
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

    // Create notification for withdraw
    await supabase.from("Notification").insert({
      id: generateId(),
      userId: userId,
      type: "transfer_out",
      title: "Retrait réussi",
      body: `Votre retrait de ${validated.amount} HTG a été complété.`,
      amount: validated.amount.toString(),
      isRead: false,
      targetId: transaction?.id,
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

// 5. REQUEST PAYMENT
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

    // Generate dynamic payment link (Point 10.1)
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
    const amount = validated.amount;
    const paymentLink = `https://piyes.ht/pay?to=${encodeURIComponent(to)}&type=${type}&amount=${amount}`;

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

// 6. SCHEDULE PAYMENT
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

// 7. QR SCAN / PAY
router.post("/scan", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { qrData, pin, amount } = req.body;
    const data = typeof qrData === "string" ? JSON.parse(qrData) : qrData;

    if (data.expiry && Date.now() > data.expiry) {
      return res.status(400).json({ error: "QR Code expired" });
    }

    // Point 11.2: Identify receiver from QR JSON (id, tag, phone, or email)
    const receiverId = data.id;
    const receiverTag = data.tag;
    const receiverPhone = data.phone;
    const receiverEmail = data.email;

    // Amount can come from QR (if it was a request) or from request body
    const paymentAmount = amount || data.amount;
    if (!paymentAmount) {
      return res.status(400).json({ error: "Amount is required" });
    }
    const amountCents = Math.round(paymentAmount * 100);

    const { data: sender } = await supabase
      .from("User")
      .select("*")
      .eq("id", userId)
      .single();
    if (!sender) throw new Error("User not found");

    // TEST MODE MVP : PIN accepté sans vérification
    // TODO: décommenter la vérification bcrypt en production
    // if (!sender.pinHash) throw new Error('PIN not set');
    // const isPinValid = await bcrypt.compare(validated.pin, sender.pinHash);
    // if (!isPinValid) throw new Error('Invalid PIN');
    console.log(`[TEST MODE] PIN bypass for user ${sender.id}`);

    if (sender.balance < amountCents) {
      throw new Error("Insufficient balance");
    }

    // Find receiver
    let receiver = null;

    // 1. Try by ID
    if (receiverId) {
      const { data } = await supabase
        .from("User")
        .select("*")
        .eq("id", receiverId)
        .maybeSingle();
      receiver = data;
    }

    // 2. Try by Tag
    if (!receiver && receiverTag) {
      const { data } = await supabase
        .from("User")
        .select("*")
        .eq("tag", receiverTag)
        .maybeSingle();
      receiver = data;
    }

    // 3. Try by Phone
    if (!receiver && receiverPhone) {
      const { data } = await supabase
        .from("User")
        .select("*")
        .eq("phone", receiverPhone)
        .maybeSingle();
      receiver = data;
    }

    // 4. Try by Email
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

    // Fetch sender's piyes account ID
    const { data: senderAccount } = await supabase
      .from("Account")
      .select("id")
      .eq("userId", sender.id)
      .eq("provider", "piyes")
      .single();
    const accountId = senderAccount?.id || "piyes-main";

    // Fetch receiver's piyes account ID
    const { data: receiverAccount } = await supabase
      .from("Account")
      .select("id")
      .eq("userId", receiver.id)
      .eq("provider", "piyes")
      .single();
    const receiverAccountId = receiverAccount?.id || "piyes-main";

    const txCode = generateTxCode();
    const authCode = generateAuthCode();
    const { data: transaction, error: txError } = await supabase
      .from("Transaction")
      .insert({
        id: generateId(),
        type: TransactionType.TRANSFER,
        amount: amountCents,
        description: `QR Payment to ${receiver.name}`,
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

    // Create receiver transaction record
    await supabase.from("Transaction").insert({
      id: generateId(),
      type: TransactionType.TRANSFER,
      amount: amountCents,
      description: `QR Payment from ${sender.name}`,
      role: TransactionRole.RECEIVER,
      counterpartyName: sender.name,
      userId: receiver.id,
      accountId: receiverAccountId,
      external_id: txCode,
      auth_code: authCode,
      date: new Date().toISOString(),
    });

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

    // Create notification for receiver
    await supabase.from("Notification").insert({
      id: generateId(),
      userId: receiver.id,
      type: "transfer_received",
      title: "Paiement QR reçu",
      body: `Vous avez reçu ${data.amount} HTG de ${sender.name}`,
      amount: data.amount.toString(),
      isRead: false,
      targetId: transaction?.id,
      route: "/history",
      timestamp: new Date().toISOString(),
    });

    // Update or Create Contact for the sender
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

// 8. HISTORY
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

    if (accountId) {
      query = query.eq("accountId", accountId);
    }

    if (counterpartyName) {
      query = query.eq("counterpartyName", counterpartyName);
    }

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

// 9. RECEIPT
router.get("/receipts/:id", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { data: tx } = await supabase
      .from("Transaction")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (!tx) return res.status(404).json({ error: "Transaction not found" });

    // Fetch user's account and user info
    const { data: account } = await supabase
      .from("Account")
      .select("*, user:User(*)")
      .eq("id", tx.accountId)
      .single();

    // Find the other side of the transaction if it's a transfer
    let counterpartyAccount = null;
    let counterpartyUser = null;

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

    const myAccount = account;
    const myUser = account?.user;

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

// 10. INTER-BANK TRANSFER
router.post(
  "/inter-bank-transfer",
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const validated = interBankTransferSchema.parse(req.body);
      const amountCents = Math.round(validated.amount * 100);

      // Fetch user
      const { data: user } = await supabase
        .from("User")
        .select("*")
        .eq("id", userId)
        .single();
      if (!user) throw new Error("User not found");

      // Fetch source and dest accounts
      let sourceAcc: any = null;
      if (validated.sourceId === "piyes-main") {
        const { data } = await supabase
          .from("Account")
          .select("*")
          .eq("userId", userId)
          .eq("provider", "piyes")
          .maybeSingle();
        if (data) {
          sourceAcc = data;
        } else {
          // Virtual piYès account if not in DB
          sourceAcc = {
            id: "piyes-main",
            userId: userId,
            provider: "piyes",
            label: "piYès",
            balance: user.balance,
            accountNumber: user.accountNumber,
          };
        }
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
        if (data) {
          destAcc = data;
        } else {
          // Virtual piYès account if not in DB
          destAcc = {
            id: "piyes-main",
            userId: userId,
            provider: "piyes",
            label: "piYès",
            balance: user.balance,
            accountNumber: user.accountNumber,
          };
        }
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

      // // If source is piYès, check PIN and balance
      // if (sourceAcc.provider === 'piyes') {
      //   if (!user.pinHash) throw new Error('PIN not set');
      //   if (!validated.pin) throw new Error('PIN required for withdrawal');
      //   const isPinValid = await bcrypt.compare(validated.pin, user.pinHash);
      //   if (!isPinValid) throw new Error('Invalid PIN');
      //   if (user.balance < amountCents) throw new Error('Insufficient balance');
      // }

      // If source is piYès, check balance only (PIN bypassed in TEST MODE)
      // TODO: réactiver la vérification bcrypt en production
      if (sourceAcc.provider === "piyes") {
        // if (!user.pinHash) throw new Error('PIN not set');
        // if (!validated.pin) throw new Error('PIN required for withdrawal');
        // const isPinValid = await bcrypt.compare(validated.pin, user.pinHash);
        // if (!isPinValid) throw new Error('Invalid PIN');
        if (user.balance < amountCents) throw new Error("Insufficient balance");
      }

      const txCode = generateTxCode();
      const authCode = generateAuthCode();

      // 1. Update source account balance
      const { error: sourceUpdateError } = await supabase
        .from("Account")
        .update({ balance: sourceAcc.balance - amountCents })
        .eq("id", sourceAcc.id);
      if (sourceUpdateError) throw sourceUpdateError;

      // 2. Update destination account balance (unless it's moncash)
      if (destAcc.provider !== "moncash") {
        const { error: destUpdateError } = await supabase
          .from("Account")
          .update({ balance: destAcc.balance + amountCents })
          .eq("id", destAcc.id);
        if (destUpdateError) {
          console.error(
            "Failed to update destination account balance:",
            destUpdateError,
          );
          throw destUpdateError;
        }
      }

      // 3. Update User balance if piyes is involved
      if (sourceAcc.provider === "piyes") {
        await supabase
          .from("User")
          .update({ balance: user.balance - amountCents })
          .eq("id", userId);
      } else if (destAcc.provider === "piyes") {
        await supabase
          .from("User")
          .update({ balance: user.balance + amountCents })
          .eq("id", userId);
      }

      // 4. Create transaction records for both sides
      const txId = generateId();
      const { data: payerTx, error: payerTxError } = await supabase
        .from("Transaction")
        .insert({
          id: txId,
          type: TransactionType.TRANSFER,
          amount: amountCents,
          description:
            validated.note ||
            `Transfert inter-bancaire: ${sourceAcc.label} -> ${destAcc.label}`,
          role: TransactionRole.PAYER,
          counterpartyName: destAcc.label,
          userId: userId,
          accountId: sourceAcc.id,
          external_id: txCode,
          auth_code: authCode,
          date: new Date().toISOString(),
        })
        .select()
        .single();

      if (payerTxError) throw payerTxError;

      await supabase.from("Transaction").insert({
        id: generateId(),
        type: TransactionType.TRANSFER,
        amount: amountCents,
        description:
          validated.note ||
          `Transfert inter-bancaire: ${sourceAcc.label} -> ${destAcc.label}`,
        role: TransactionRole.RECEIVER,
        counterpartyName: sourceAcc.label,
        userId: userId,
        accountId: destAcc.id,
        external_id: txCode,
        auth_code: authCode,
        date: new Date().toISOString(),
      });

      res.json(payerTx);
    } catch (error: any) {
      console.error("Inter-bank transfer error:", error);
      res
        .status(400)
        .json({ error: { message: error.message || "Transfer failed" } });
    }
  },
);

// 11. MONCASH CONFIRMATION
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

        // Update user balance
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

        // Update or create transaction record
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
            accountId: "piyes-main", // Default to main account
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
    let startDate: Date;
    let prevStartDate: Date;
    let prevEndDate: Date;

    // Plage personnalisée
    if (period === "custom" && from && to) {
      startDate = new Date(from as string);
      const toDate = new Date(to as string);
      toDate.setHours(23, 59, 59, 999);
      const duration = toDate.getTime() - startDate.getTime();
      prevEndDate = new Date(startDate);
      prevStartDate = new Date(startDate.getTime() - duration);

      // Utiliser directement ces dates pour la requête
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

      // Réutiliser la même logique de calcul — injecter les données
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
      default: // month
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        prevStartDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        prevEndDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    let txs: any[] = [];
    let prevTxs: any[] = [];

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

    // Calculs période courante
    const received = txs.filter((t) => t.role === "RECEIVER");
    const sent = txs.filter((t) => t.role === "PAYER");
    const totalReceived = received.reduce((s, t) => s + t.amount, 0) / 100;
    const totalSent = sent.reduce((s, t) => s + t.amount, 0) / 100;

    // Calculs période précédente
    const prevReceived =
      prevTxs
        .filter((t) => t.role === "RECEIVER")
        .reduce((s, t) => s + t.amount, 0) / 100;
    const prevSent =
      prevTxs
        .filter((t) => t.role === "PAYER")
        .reduce((s, t) => s + t.amount, 0) / 100;

    // Top 5 payeurs (counterpartyName des transactions reçues)
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

    // Répartition par heure
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

    // Répartition par type
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

    // Fréquence des payeurs
    const senderCounts = Array.from(senderMap.values()).map((v) => v.count);
    const frequencyBreakdown = {
      once: senderCounts.filter((c) => c === 1).length,
      repeat: senderCounts.filter((c) => c >= 2 && c <= 4).length,
      frequent: senderCounts.filter((c) => c >= 5).length,
    };

    // Frais estimés (1% transfert + 2% service = 3% sur transactions envoyées)
    const totalFeesPaid = totalSent * 0.03;

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
      topSenders,
      byHour,
      byType,
      avgTransactionAmount:
        txs.length > 0 ? (totalReceived + totalSent) / txs.length : 0,
      totalFeesPaid,
      frequencyBreakdown,
    });
  } catch (error) {
    console.error("Reports error:", error);
    res.status(500).json({ error: "Failed to generate report" });
  }
});

// 13. INTERNATIONAL
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

    // 1. Créer la transaction dans Transaction (pour historique)
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

    // 2. Créer l'enregistrement dans InternationalTransfer (pour traçabilité)
    const feesCents = Math.round(amountCents * 0.01); // 1% frais
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

    // 3. Débiter le solde
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

// ─────────────────────────────────────────────────────────────────────────────
// 14. PRE-CHECK destinataire avant transfert (existence + permission)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/resolve/:key", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const key = decodeURIComponent(String(req.params.key)).trim();
    if (!key) return res.status(400).json({ error: "Clé requise" });

    let receiver: any = null;

    // 1. Chercher dans User par tag (ilike pour ignorer la casse)
    if (key.startsWith("@") || !key.includes("@")) {
      const tagValue = key.startsWith("@") ? key : `@${key}`;
      const { data } = await supabase
        .from("User")
        .select("id, name, tag, phone, email, avatarUrl")
        .ilike("tag", tagValue)
        .maybeSingle();
      if (data) receiver = data;
    }

    // 2. Chercher par email
    if (!receiver && key.includes("@") && key.includes(".")) {
      const { data } = await supabase
        .from("User")
        .select("id, name, tag, phone, email, avatarUrl")
        .ilike("email", key)
        .maybeSingle();
      if (data) receiver = data;
    }

    // 3. Chercher par accountNumber
    if (!receiver) {
      const { data } = await supabase
        .from("User")
        .select("id, name, tag, phone, email, avatarUrl")
        .eq("accountNumber", key)
        .maybeSingle();
      if (data) receiver = data;
    }

    // 3b. Chercher par phone dans User (clé primaire)
    if (!receiver) {
      // Normaliser le format du phone : +509 suivi de 8 chiffres
      let normalizedPhone = key;
      if (!normalizedPhone.startsWith("+")) {
        normalizedPhone = normalizedPhone.startsWith("509")
          ? `+${normalizedPhone}`
          : `+509${normalizedPhone}`;
      }
      const { data } = await supabase
        .from("User")
        .select("id, name, tag, phone, email, avatarUrl")
        .eq("phone", normalizedPhone)
        .maybeSingle();
      if (data) receiver = data;
    }

    // 4. Chercher par ID direct
    if (!receiver) {
      const { data } = await supabase
        .from("User")
        .select("id, name, tag, phone, email, avatarUrl")
        .eq("id", key)
        .maybeSingle();
      if (data) receiver = data;
    }

    // 5. Chercher dans Key table (clés secondaires vérifiées)
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

    // Vérifier permission sur le compte piYès du receiver
    const { data: receiverAccount } = await supabase
      .from("Account")
      .select("permission")
      .eq("userId", receiver.id)
      .eq("provider", "piyes")
      .maybeSingle();

    // Autoriser si : compte existe avec permission 'oui', OU pas de compte du tout (edge case ancien user)
    // Bloquer uniquement si permission explicitement définie à autre chose que 'oui'
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

export default router;
