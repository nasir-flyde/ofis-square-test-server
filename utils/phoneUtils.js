/**
 * Normalizes a phone number to the standard format used in the system: +91-XXXXXXXXXX
 * @param {string|number} phone - The phone number to normalize
 * @returns {string} The normalized phone number or the original if invalid
 */
export const normalizePhone = (phone) => {
    if (!phone) return phone;

    let clean = phone.toString().replace(/\D/g, '');

    // Remove leading zeros
    clean = clean.replace(/^0+/, '');

    // If we have more than 10 digits, assume the last 10 are the local number
    if (clean.length > 10) {
        clean = clean.slice(-10);
    }

    if (clean.length === 10) {
        return `+91-${clean}`;
    }

    return phone.toString().trim();
};

/**
 * Returns an array of possible formats for a phone number for flexible database queries
 * @param {string|number} phone - The phone number
 * @returns {string[]} Array of phone number formats
 */
export const getPhoneFormats = (phone) => {
    if (!phone) return [];

    let clean = phone.toString().replace(/\D/g, '');
    clean = clean.replace(/^0+/, '');

    if (clean.length > 10) {
        clean = clean.slice(-10);
    }

    if (clean.length === 10) {
        return [
            clean,             // 10 digits: 7809690538
            `+91-${clean}`,    // Prefixed: +91-7809690538
            `91${clean}`,      // Without dash/plus: 917809690538
            `+91${clean}`      // Without dash: +917809690538
        ];
    }

    return [phone.toString().trim()];
};
