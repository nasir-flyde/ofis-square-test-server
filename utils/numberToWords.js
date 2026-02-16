/**
 * Convert a number to words (Indian numbering system)
 * e.g., 560000 -> "Five Lakhs Sixty Thousand"
 */
export const numberToWords = (num) => {
    const a = [
        '',
        'One ',
        'Two ',
        'Three ',
        'Four ',
        'Five ',
        'Six ',
        'Seven ',
        'Eight ',
        'Nine ',
        'Ten ',
        'Eleven ',
        'Twelve ',
        'Thirteen ',
        'Fourteen ',
        'Fifteen ',
        'Sixteen ',
        'Seventeen ',
        'Eighteen ',
        'Nineteen ',
    ];
    const b = [
        '',
        '',
        'Twenty',
        'Thirty',
        'Forty',
        'Fifty',
        'Sixty',
        'Seventy',
        'Eighty',
        'Ninety',
    ];

    const n = num ? num.toString() : '';
    if (!n) return '';

    // Clean up
    let str = n.replace(/[, ]/g, '');
    if (parseInt(str) === 0) return 'Zero';

    // Split into integer and decimal
    const parts = str.split('.');
    const integerPart = parseInt(parts[0]);

    if (integerPart === 0) return '';

    const convertGroup = (n) => {
        if (n < 20) return a[n];
        const digit = n % 10;
        if (n < 100) return b[Math.floor(n / 10)] + (digit ? ' ' + a[digit] : ' ');
        if (n < 1000) return a[Math.floor(n / 100)] + 'Hundred ' + (n % 100 == 0 ? '' : convertGroup(n % 100));
        return '';
    };

    // Indian Numbering System: 
    // 10,00,00,000 (Ten Crores)
    // 1,00,000 (One Lakh)
    // 1,000 (One Thousand)

    let output = '';
    let rem = integerPart;

    // Crores (1,00,00,000)
    const crores = Math.floor(rem / 10000000);
    rem = rem % 10000000;
    if (crores > 0) {
        output += convertGroup(crores) + 'Crore ';
    }

    // Lakhs (1,00,000)
    const lakhs = Math.floor(rem / 100000);
    rem = rem % 100000;
    if (lakhs > 0) {
        output += convertGroup(lakhs) + 'Lakhs '; // Using "Lakhs" as per user preference often
    } else if (lakhs === 1) {
        // output += 'One Lakh '; 
        // Simplified: just handle plural/singular if needed, but 'Lakhs' is often acceptable in Indian context generic
    }

    // Thousands
    const thousands = Math.floor(rem / 1000);
    rem = rem % 1000;
    if (thousands > 0) {
        output += convertGroup(thousands) + 'Thousand ';
    }

    // Hundreds and below
    if (rem > 0) {
        output += convertGroup(rem);
    }

    return output.trim();
};
