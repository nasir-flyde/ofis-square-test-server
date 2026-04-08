import crypto from "crypto";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const ALGORITHM = "aes-256-cbc";
const IV_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Gets the encryption key from environment variables.
 * Ensures the key is exactly 32 bytes for aes-256-cbc.
 */
const getEncryptionKey = () => {
    const key = process.env.DOCUMENT_ENCRYPTION_KEY;
    if (!key) {
        console.error("ERROR: DOCUMENT_ENCRYPTION_KEY is NOT set in environment!");
        throw new Error("DOCUMENT_ENCRYPTION_KEY is not defined in environment variables");
    }
    const hash = crypto.createHash('sha256').update(String(key)).digest();
    console.log(`Encryption key loaded. Hash (first 4 bytes): ${hash.subarray(0, 4).toString('hex')}`);
    return hash;
};

/**
 * Encrypts a Buffer using AES-256-CBC.
 * The IV is prefixed to the encrypted data for storage.
 * @param {Buffer} buffer - The data to encrypt
 * @returns {Buffer} - The encrypted data (IV + Ciphertext)
 */
export const encryptBuffer = (buffer) => {
    if (!Buffer.isBuffer(buffer)) {
        buffer = Buffer.from(buffer);
    }
    
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = getEncryptionKey();
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    
    // Return IV (16 bytes) + Encrypted Data
    return Buffer.concat([iv, encrypted]);
};

/**
 * Decrypts a Buffer using AES-256-CBC.
 * Expects the IV to be prefixed to the data.
 * @param {Buffer} buffer - The encrypted data (IV + Ciphertext)
 * @returns {Buffer} - The decrypted data
 */
export const decryptBuffer = (buffer) => {
    if (!Buffer.isBuffer(buffer)) {
        buffer = Buffer.from(buffer);
    }

    try {
        const iv = buffer.subarray(0, IV_LENGTH);
        const encryptedData = buffer.subarray(IV_LENGTH);
        const key = getEncryptionKey();
        
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
        
        return decrypted;
    } catch (error) {
        console.error("Decryption failed:", error.message);
        // If decryption fails, it might be unencrypted or wrong key.
        // We throw for higher-level logic to decide fallback.
        throw error;
    }
};
