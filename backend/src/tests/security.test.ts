import { CryptoService } from '../services/crypto.service';
import { areResolvedAddressesSafe, isRestrictedIP } from '../services/ssrf-guard.service';
import { AppError } from '../utils/AppError';
import crypto from 'crypto';

describe('Security Infrastructure', () => {
  describe('CryptoService (AES-256-GCM)', () => {
    let service: CryptoService;
    
    beforeAll(() => {
      // Setup a valid 32-byte key for testing
      const key = crypto.randomBytes(32).toString('base64');
      process.env.ENCRYPTION_KEY = key;
      service = new CryptoService();
    });

    it('Should cleanly encrypt and decrypt strings', () => {
      const secret = 'super-secret-api-token';
      const encrypted = service.encrypt(secret);
      
      expect(encrypted).not.toBe(secret);
      expect(encrypted.split(':').length).toBe(3); // IV:AuthTag:Ciphertext
      
      const decrypted = service.decrypt(encrypted);
      expect(decrypted).toBe(secret);
    });

    it('Should violently throw AppError if ciphertext is tampered with (AuthTag validation)', () => {
      const secret = 'super-secret-api-token';
      const encrypted = service.encrypt(secret);
      
      // Tamper with the ciphertext
      const parts = encrypted.split(':');
      parts[2] = 'tamperedData';
      const brokenEncrypted = parts.join(':');
      
      expect(() => service.decrypt(brokenEncrypted)).toThrow(AppError);
      expect(() => service.decrypt(brokenEncrypted)).toThrow(/tampered/i);
    });
  });

  describe('SSRF Guard', () => {
    it('Should block localhost variations', () => {
      expect(isRestrictedIP('127.0.0.1')).toBe(true);
      expect(isRestrictedIP('127.1.2.3')).toBe(true);
      expect(isRestrictedIP('0.0.0.0')).toBe(true);
      expect(isRestrictedIP('::1')).toBe(true);
      expect(isRestrictedIP('::')).toBe(true);
      expect(isRestrictedIP('fc00::1')).toBe(true);
      expect(isRestrictedIP('fd12:3456::1')).toBe(true);
      expect(isRestrictedIP('fe80::1')).toBe(true);
      expect(isRestrictedIP('febf::1')).toBe(true);
      expect(isRestrictedIP('ff02::1')).toBe(true);
      expect(isRestrictedIP('::ffff:127.0.0.1')).toBe(true);
      expect(isRestrictedIP('::ffff:7f00:1')).toBe(true);
    });

    it('Should block AWS/Cloud metadata IPs', () => {
      expect(isRestrictedIP('169.254.169.254')).toBe(true);
      expect(isRestrictedIP('169.254.0.1')).toBe(true);
      expect(isRestrictedIP('168.63.129.16')).toBe(true);
      expect(isRestrictedIP('100.100.100.200')).toBe(true);
    });

    it('Should block private class A/B/C ranges', () => {
      expect(isRestrictedIP('10.20.30.40')).toBe(true); // 10/8
      expect(isRestrictedIP('192.168.1.1')).toBe(true); // 192.168/16
      expect(isRestrictedIP('172.16.0.1')).toBe(true); // 172.16/12
      expect(isRestrictedIP('172.31.255.255')).toBe(true); // 172.16/12 upper bound
      expect(isRestrictedIP('100.64.1.2')).toBe(true);
    });

    it('Should ALLOW valid public IP addresses', () => {
      expect(isRestrictedIP('8.8.8.8')).toBe(false); // Google DNS
      expect(isRestrictedIP('104.16.123.96')).toBe(false); // Cloudflare
      expect(isRestrictedIP('172.32.0.1')).toBe(false); // Public IP just outside private range
      expect(isRestrictedIP('2606:4700:4700::1111')).toBe(false);
    });

    it('rejects DNS answers if any address is restricted, including mixed IPv4/IPv6 answers', () => {
      expect(areResolvedAddressesSafe(['8.8.8.8', '2606:4700:4700::1111'])).toBe(true);
      expect(areResolvedAddressesSafe(['8.8.8.8', '127.0.0.1'])).toBe(false);
      expect(areResolvedAddressesSafe(['2606:4700:4700::1111', 'fe80::1'])).toBe(false);
      expect(areResolvedAddressesSafe([])).toBe(false);
    });
  });
});
