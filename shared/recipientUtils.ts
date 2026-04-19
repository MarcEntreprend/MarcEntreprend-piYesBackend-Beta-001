// shared/recipientUtils.ts

export enum RecipientType {
  EMAIL = 'email',
  PHONE = 'phone',
  TAG = 'tag',
  RANDOM_KEY = 'random',
  INVALID = 'invalid'
}

export const formatRecipientValue = (value: string): string => {
  if (!value) return '';
  const clean = value.trim().replace(/[\s-]/g, '');
  
  // Email check
  if (clean.includes('@') && clean.includes('.')) {
    return clean.toLowerCase();
  }
  
  // Phone check
  if (/^\d{8}$/.test(clean)) {
    return `+509${clean}`;
  }
  if (/^509\d{8}$/.test(clean)) {
    return `+${clean}`;
  }
  if (/^\+509\d{8}$/.test(clean)) {
    return clean;
  }
  
  // Tag check
  if (clean.startsWith('@')) {
    return clean.toLowerCase();
  }
  
  // Random key check (25 chars)
  if (clean.length === 25 && /^[a-z0-9]+$/.test(clean.toLowerCase())) {
    return clean.toLowerCase();
  }
  
  return clean;
};

export const getRecipientType = (value: string): RecipientType => {
  if (!value) return RecipientType.INVALID;
  const clean = value.trim().replace(/[\s-]/g, '');
  
  // Email regex: simple but effective
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) && clean.length <= 320) {
    return RecipientType.EMAIL;
  }
  
  // Phone regex: 8 digits, with or without 509/+509
  if (/^(\+509|509)?\d{8}$/.test(clean)) {
    return RecipientType.PHONE;
  }
  
  // Tag regex: starts with @, at least 1 char after
  if (clean.startsWith('@') && clean.length > 1) {
    return RecipientType.TAG;
  }
  
  // Random key: exactly 25 alphanumeric chars
  if (clean.length === 25 && /^[a-z0-9]+$/.test(clean.toLowerCase())) {
    return RecipientType.RANDOM_KEY;
  }
  
  return RecipientType.INVALID;
};

export const isOwnKey = (value: string, user: any): boolean => {
  if (!user) return false;
  const formatted = formatRecipientValue(value).toLowerCase();
  
  const userTag = user.tag?.toLowerCase();
  const userEmail = user.email?.toLowerCase();
  const userPhone = user.phone?.replace(/[\s-]/g, '');
  
  if (userTag && formatted === userTag) return true;
  if (userEmail && formatted === userEmail) return true;
  if (userPhone && formatted === userPhone) return true;
  
  // Check secondary keys
  if (user.secondaryKeys) {
    return user.secondaryKeys.some((k: any) => k.value.toLowerCase() === formatted);
  }
  
  return false;
};
