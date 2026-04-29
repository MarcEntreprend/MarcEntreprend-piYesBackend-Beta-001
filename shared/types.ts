// shared/types.ts
export enum TransactionType {
  DEPOSIT = "DEPOSIT",
  WITHDRAW = "WITHDRAW",
  TRANSFER = "TRANSFER",
  CARD_PAYMENT = "CARD_PAYMENT",
  INTERNATIONAL = "INTERNATIONAL",
  RECHARGE = "RECHARGE",
  REQUEST = "REQUEST",
  SCHEDULED = "SCHEDULED",
}

export enum TransactionRole {
  PAYER = "PAYER",
  RECEIVER = "RECEIVER",
}

export type VerificationStatus = "unverified" | "pending" | "verified";

export interface User {
  id: string;
  name: string;
  tag: string;
  firstName?: string;
  lastName?: string;
  accountType?: "individual" | "business";
  email: string;
  accountNumber: string;
  balance: number;
  mfaEnabled: boolean;
  biometricsEnabled: boolean;
  verificationStatus: VerificationStatus;
  hasPin: boolean;
  isDeviceVerified: boolean;
  phone?: string;
  dob?: string;
  address?: string;
  nationality?: string;
  idNumber?: string;
  language?: string;
  timezone?: string;
  avatarUrl?: string;
  initials?: string;
  secondaryKeys?: Key[];
  privacySettings?: PrivacySettings;
  createdAt?: string;
  updatedAt?: string;
  otpCode?: string;
}

export interface BusinessProfile {
  id: string;
  userId: string;
  companyName?: string;
  sector?: string;
  nif?: string;
  address?: string;
  repName?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PrivacySettings {
  blockRequestsFrom:
    | "none"
    | "everyone"
    | "contacts"
    | "non_contacts"
    | "specific";
  blockTransfersFrom:
    | "none"
    | "everyone"
    | "contacts"
    | "non_contacts"
    | "specific";
  blockedEntities: string[]; // tags or IDs
  visibility: "everyone" | "contacts_only" | "mutual_only" | "private";
  allowAnonymousTransfers: boolean;
  hideTagInReceipts: boolean;
  requestsOnlyFromFriends: boolean;
}

export interface Account {
  id: string;
  provider: "piyes" | "buh" | "moncash" | "unibank" | string;
  label: string;
  balance: number;
  color: string;
  accountNumber: string;
  logoText: string;
  logoUrl?: string;
  status?: "active" | "pending" | "failed" | "inactive";
  isVerified?: boolean;
  kycStatus?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ExternalBank {
  id: string;
  name: string;
  logoUrl?: string;
  logoText: string;
  color: string;
  provider: string;
}

export interface LinkBankRequest {
  bankId: string;
  credentials: Record<string, string>;
}

// --- NEW TYPES FOR SERVICES ---

export interface Beneficiary {
  id: string;
  name: string;
  bankName: string;
  accountNumber: string;
  type: "domestic" | "international";
  avatarUrl?: string;
  isFavorite: boolean;
}

export interface ReminderSlot {
  date: string; // ISO date string YYYY-MM-DD
  time1Active: boolean; // 08h30
  time2Active: boolean; // 12h30
}

export interface ScheduledPayment {
  id: string;
  userId?: string;
  title: string;
  counterparty: string; // nom texte du payeur
  payerUserId?: string; // userId du payeur (si user piYès)
  receiverUserId?: string; // userId du receiver
  amount: number;
  dueDate: string;
  status: "pending" | "confirmed" | "paid" | "cancelled";
  type: "incoming" | "outgoing";
  frequency?: "once" | "weekly" | "monthly";
  reminders?: ReminderSlot[];
  confirmedAt?: string | null;
  qrToken?: string | null;
  qrExpiresAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ReceivingAccount {
  id: string;
  currency: "USD" | "EUR" | "HTG" | "DOP";
  label: string;
  accountNumber: string;
  routingNumber?: string;
  swiftCode?: string;
  balance: number;
  status: "active" | "pending";
}

export interface CapitalOffer {
  id: string;
  type: "advance" | "loan";
  amount: number;
  interestRate: number;
  termMonths: number;
  monthlyPayment: number;
  totalRepayment: number;
  status: "available" | "accepted" | "repaid";
}

export interface TaxDocument {
  id: string;
  year: number;
  type: "annual_statement" | "tax_withholding";
  issueDate: string;
  fileSize: string;
  downloadUrl: string;
}

/**
 * Added missing Receipt interface
 */
export interface Receipt {
  id: string;
  amount: number;
  status: "success" | "pending" | "failed" | string;
  date: string;
  receipt_type: string;
  auth_code?: string;
  external_id: string;
  transaction_id?: string;
  moncashTransactionId?: string;
  description?: string;
  sender?: {
    name: string;
    account_number?: string;
    masked_account?: string;
    idNumber?: string;
    bank?: string;
  };
  receiver?: {
    name: string;
    account_number?: string;
    masked_account?: string;
    idNumber?: string;
    bank?: string;
  };
  client?: { name: string; account_number?: string };
  agent?: { name: string; agent_id?: string };
  qr_code?: string;
  qr_code_url?: string;
  currency?: string;
  country?: string;
  fees?: number;
  operator?: string;
  phoneNumber?: string;
  counterparty?: string;
}

// --- EXISTING TYPES ---

export interface SyncResponse {
  user: User;
  accounts: Account[];
  recentHistory: Transaction[];
  cards: Card[];
  contacts: Contact[];
  friendships: Friendship[];
  unreadNotificationsCount: number;
  serverTime: string;
  config: {
    maintenance: boolean;
    updateRequired: boolean;
  };
}

export interface Ad {
  id: string;
  title: string;
  description: string;
  price: number;
  location: string;
  category: string;
  images: string[];
  rating: number;
  date: string;
  seller: {
    id: string;
    name: string;
    avatar: string;
    phone?: string;
    acceptsPiyes: boolean;
  };
  specs?: { label: string; value: string; icon: string | any }[];
  views: number;
  messages: number;
}

export interface Message {
  id: string;
  senderId: string;
  text: string;
  timestamp: string;
}

export interface Conversation {
  id: string;
  adId: string;
  adTitle: string;
  adPrice: number;
  adImage: string;
  role: "buyer" | "seller";
  counterparty: {
    id: string;
    name: string;
    avatar: string;
    isVerified?: boolean;
  };
  messages: Message[];
  lastMessage: string;
  lastTime: string;
  unreadCount: number;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  description: string;
  date: string;
  role: TransactionRole;
  counterpartyName: string;
  auth_code?: string;
  external_id?: string;
  status?: "PENDING" | "COMPLETED" | "FAILED";
  moncashTransactionId?: string;
}

export enum CardStatus {
  ACTIVE = "active",
  BLOCKED = "blocked",
  EXPIRED = "expired",
}

export enum CardType {
  VIRTUAL = "virtual",
  PHYSICAL = "physical",
  EXTERNAL = "external",
}

export interface Card {
  id: string;
  type: CardType;
  brand: "visa" | "mastercard" | "piyes";
  lastFour: string;
  expiryDate: string;
  status: CardStatus;
  color: string;
  nameOnCard: string;
  cvv: string;
  limit: number;
  isFrozen: boolean;
  settings: {
    onlinePayments: boolean;
    international: boolean;
    contactless: boolean;
  };
}

export interface Contact {
  id: string;
  name: string;
  repertoireName?: string;
  tag: string;
  initials?: string;
  userId: string; // The owner of this contact entry
  app: string;
  isVerified?: boolean;
  isPair?: boolean;
  isMutual?: boolean;
  phone?: string;
  email?: string;
  randomKey?: string;
  avatarUrl?: string;
  isFavorite?: boolean;
  type?: "individual" | "company";
  companyName?: string;
  activityType?: string;
  address?: string;
  contactUserId?: string; // The piYès userId if linked
  lastTransactionDate?: string;
}

export enum FriendshipStatus {
  PENDING = "pending",
  FRIENDS = "friends",
  BLOCKED = "blocked",
}

export interface Friendship {
  id: string;
  requesterId: string;
  receiverId: string;
  status: FriendshipStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Key {
  id: string;
  type: "email" | "phone" | "random" | "nif" | "tag";
  value: string;
  createdAt: string;
  isVerified?: boolean;
  isPrimary?: boolean;
}

export interface AuthResponse {
  user: User;
  token: string;
}

export const getInitials = (name: string): string => {
  if (!name) return "??";
  const parts = name.trim().split(/\s+/);
  if (parts.length > 1) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return parts[0][0].toUpperCase();
};
