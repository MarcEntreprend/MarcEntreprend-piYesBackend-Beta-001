// shared/schemas.ts

import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().optional(),
  phone: z.string().optional(),
  password: z.string().min(6),
  device: z.string().optional(),
}).refine(data => data.email || data.phone, {
  message: "Either email or phone must be provided",
  path: ["email"]
});

export const signupSchema = z.object({
  firstName: z.string().min(1, "First name required"),   // obligatoire
  lastName: z.string().min(1, "Last name required"),     // obligatoire
  name: z.string().optional(),                           // sera construit côté backend
  email: z.string().email().optional().or(z.literal('')).transform(val => val === '' ? undefined : val),
  phone: z.string().optional().or(z.literal('')).transform(val => val === '' ? undefined : val),
  password: z.string().min(6),
  device: z.string().optional(),
  accountType: z.enum(["individual", "business"]).default("individual"), // obligatoire, valeur par défaut
  // Champs spécifiques business
  companyName: z.string().optional(),
  sector: z.string().optional(),
  nif: z.string().optional(),
  address: z.string().optional(),
repName: z.string().optional(),
  legalRepresentative: z.string().optional(),
}).refine(data => {
  const hasEmail = data.email && data.email.trim().length > 0;
  const hasPhone = data.phone && data.phone.trim().length > 0;
  return hasEmail || hasPhone;
}, {
  message: "Either email or phone must be provided",
  path: ["email"]
});



export const transferSchema = z.object({
  amount: z.number().positive(),
  contactId: z.string(),
  description: z.string().optional(),
  pin: z.string().length(4),
  schedulerId: z.string().optional(), // lien vers un rappel scheduler
});

export const rechargeSchema = z.object({
  phoneNumber: z.string(),
  amount: z.number().positive(),
  operatorId: z.string(),
  accountId: z.string(),
  pin: z.string().length(4),
});

export const pinSchema = z.object({
  pin: z.string().length(4),
});

export const requestPaymentSchema = z.object({
  amount: z.number().positive(),
  payer: z.string().optional(),
  description: z.string().optional(),
  key: z.string().optional(),
});

export const schedulePaymentSchema = z.object({
  amount: z.number().positive(),
  counterparty: z.string(),
  dueDate: z.string(), // ISO string
  title: z.string().optional(),
  type: z.enum(['incoming', 'outgoing']),
  frequency: z.enum(['once', 'weekly', 'monthly']).default('once'),
});

export const depositWithdrawSchema = z.object({
  amount: z.number().positive(),
  accountId: z.string(),
  pin: z.string().length(4).optional(),
});

export const interBankTransferSchema = z.object({
  sourceId: z.string(),
  destId: z.string(),
  amount: z.number().positive(),
  note: z.string().optional(),
  pin: z.string().length(4).optional(),
});
