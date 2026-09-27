import crypto from 'crypto';
import { AppError } from '../utils/AppError';

export class CryptoService {
  private readonly ALGORITHM = 'aes-256-gcm';
  private readonly key: Buffer;

  constructor() {
    const rawKey = process.env.ENCRYPTION_KEY;
    if (!rawKey) {
      throw new Error('FATAL: ENCRYPTION_KEY environment variable is not set.');
    }

    this.key = Buffer.from(rawKey, 'base64');
    
    if (this.key.length !== 32) {
      throw new Error('FATAL: ENCRYPTION_KEY must be exactly 32 bytes (256 bits).');
    }
  }

  /**
   * Encrypts a plaintext string using AES-256-GCM.
   * Format: IV(12 bytes):AuthTag(16 bytes):Ciphertext
   */
  public encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(this.ALGORITHM, this.key, iv);
    
    let ciphertext = cipher.update(plaintext, 'utf8', 'base64');
    ciphertext += cipher.final('base64');
    
    const authTag = cipher.getAuthTag();

    return `${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext}`;
  }

  /**
   * Decrypts a ciphertext string using AES-256-GCM.
   */
  public decrypt(encryptedData: string): string {
    try {
      const parts = encryptedData.split(':');
      if (parts.length !== 3) {
        throw new Error('Invalid encrypted format.');
      }

      const iv = Buffer.from(parts[0], 'base64');
      const authTag = Buffer.from(parts[1], 'base64');
      const ciphertext = parts[2];

      const decipher = crypto.createDecipheriv(this.ALGORITHM, this.key, iv);
      decipher.setAuthTag(authTag);

      let plaintext = decipher.update(ciphertext, 'base64', 'utf8');
      plaintext += decipher.final('utf8');

      return plaintext;
    } catch (error) {
      // Never log the raw decrypted secrets or specific crypto errors
      throw new AppError('Failed to decrypt data. The payload may have been tampered with or the key is invalid.', 500);
    }
  }
}

let cryptoInstance: CryptoService | undefined;

export const cryptoService = {
  encrypt(plaintext: string): string {
    cryptoInstance ??= new CryptoService();
    return cryptoInstance.encrypt(plaintext);
  },
  decrypt(ciphertext: string): string {
    cryptoInstance ??= new CryptoService();
    return cryptoInstance.decrypt(ciphertext);
  },
};
