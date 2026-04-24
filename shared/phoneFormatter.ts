// shared/phoneFormatter.ts

/**
 * Format a Haitian phone number for display: +509 XXXX XXXX
 * Handles multiple input formats: 8 digits, 11 digits with +509, raw
 * @param val - Raw phone number string
 * @returns Formatted string like "+509 1234 5678", or original if invalid
 */
export const formatPhoneDisplay = (val: string | null | undefined): string => {
    if (!val) return "";

    // Already formatted: +509 XXXX XXXX
    if (/^\+509 \d{4} \d{4}$/.test(val)) return val;

    const digits = val.replace(/\D/g, "");

    // 8 digits local number
    if (digits.length === 8) {
        return `+509 ${digits.slice(0, 4)} ${digits.slice(4)}`;
    }

    // 11 digits with 509 prefix (+509XXXXXXXX)
    if (digits.length === 11 && digits.startsWith("509")) {
        return `+509 ${digits.slice(3, 7)} ${digits.slice(7)}`;
    }

    // Any other format — return as-is
    return val;
};

/**
 * Extract raw digits from a phone number (for storage/API)
 * @param val - Formatted or raw phone number
 * @returns Only digits, e.g. "12345678" or "50912345678"
 */
export const extractPhoneDigits = (val: string): string => {
    return val.replace(/\D/g, "");
};

/**
 * Check if a string looks like a Haitian phone number
 * @param val - Value to test
 * @returns true if it matches Haitian phone format
 */
export const isHaitianPhone = (val: string): boolean => {
    const digits = val.replace(/\D/g, "");
    return digits.length === 8 || (digits.length === 11 && digits.startsWith("509"));
};