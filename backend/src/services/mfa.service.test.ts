/**
 * Unit tests for MFA Service
 *
 * Tests TOTP generation, verification, base32 encoding/decoding,
 * privileged role detection, and MFA enforcement logic.
 */

import { describe, it, expect } from 'vitest';
import {
  generateSecret,
  generateTOTP,
  verifyTOTP,
  generateOtpAuthUri,
  isPrivilegedRole,
  base32Encode,
  base32Decode,
  PRIVILEGED_ROLES,
} from './mfa.service.js';

describe('MFA Service', () => {
  describe('isPrivilegedRole', () => {
    it('returns true for dispatcher', () => {
      expect(isPrivilegedRole('dispatcher')).toBe(true);
    });

    it('returns true for supervisor', () => {
      expect(isPrivilegedRole('supervisor')).toBe(true);
    });

    it('returns true for administrator', () => {
      expect(isPrivilegedRole('administrator')).toBe(true);
    });

    it('returns false for survivor', () => {
      expect(isPrivilegedRole('survivor')).toBe(false);
    });

    it('returns false for responder', () => {
      expect(isPrivilegedRole('responder')).toBe(false);
    });

    it('returns false for auditor', () => {
      expect(isPrivilegedRole('auditor')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isPrivilegedRole('')).toBe(false);
    });
  });

  describe('generateSecret', () => {
    it('generates a non-empty base32 string', () => {
      const secret = generateSecret();
      expect(secret).toBeTruthy();
      expect(secret.length).toBeGreaterThan(0);
    });

    it('generates valid base32 characters', () => {
      const secret = generateSecret();
      expect(secret).toMatch(/^[A-Z2-7]+$/);
    });

    it('generates a 32-character string (160 bits = 32 base32 chars)', () => {
      const secret = generateSecret();
      expect(secret.length).toBe(32);
    });

    it('generates unique secrets on each call', () => {
      const secret1 = generateSecret();
      const secret2 = generateSecret();
      expect(secret1).not.toBe(secret2);
    });
  });

  describe('base32Encode / base32Decode', () => {
    it('encodes and decodes round-trip correctly', () => {
      const original = Buffer.from('Hello, World!');
      const encoded = base32Encode(original);
      const decoded = base32Decode(encoded);
      expect(decoded).toEqual(original);
    });

    it('encodes known value correctly', () => {
      // "test" in base32 is "ORSXG5A="  (without padding: "ORSXG5A")
      const encoded = base32Encode(Buffer.from('test'));
      expect(encoded).toBe('ORSXG5A');
    });

    it('decodes case-insensitively', () => {
      const upper = base32Decode('ORSXG5A');
      const lower = base32Decode('orsxg5a');
      expect(upper).toEqual(lower);
    });

    it('handles empty buffer', () => {
      const encoded = base32Encode(Buffer.alloc(0));
      expect(encoded).toBe('');
    });

    it('throws on invalid base32 characters', () => {
      expect(() => base32Decode('0189!')).toThrow();
    });
  });

  describe('generateTOTP', () => {
    it('generates a 6-digit code', () => {
      const secret = generateSecret();
      const code = generateTOTP(secret);
      expect(code).toMatch(/^\d{6}$/);
    });

    it('generates same code for same time window', () => {
      const secret = generateSecret();
      // Pick a time at the start of a 30-second window so +10 is still in the same window
      const windowStart = Math.floor(1700000000 / 30) * 30; // Align to window boundary
      const code1 = generateTOTP(secret, windowStart);
      const code2 = generateTOTP(secret, windowStart + 10); // Same 30s window
      expect(code1).toBe(code2);
    });

    it('generates different code for different time window', () => {
      const secret = generateSecret();
      const time = 1700000000;
      const code1 = generateTOTP(secret, time);
      const code2 = generateTOTP(secret, time + 30); // Next window
      expect(code1).not.toBe(code2);
    });

    it('generates different codes for different secrets', () => {
      const secret1 = generateSecret();
      const secret2 = generateSecret();
      const time = 1700000000;
      const code1 = generateTOTP(secret1, time);
      const code2 = generateTOTP(secret2, time);
      expect(code1).not.toBe(code2);
    });
  });

  describe('verifyTOTP', () => {
    it('verifies correct code for current time', () => {
      const secret = generateSecret();
      const time = 1700000000;
      const code = generateTOTP(secret, time);
      expect(verifyTOTP(secret, code, time)).toBe(true);
    });

    it('verifies code from previous time window (clock drift tolerance)', () => {
      const secret = generateSecret();
      const time = 1700000000;
      const prevCode = generateTOTP(secret, time - 30); // Previous window
      expect(verifyTOTP(secret, prevCode, time)).toBe(true);
    });

    it('verifies code from next time window (clock drift tolerance)', () => {
      const secret = generateSecret();
      const time = 1700000000;
      const nextCode = generateTOTP(secret, time + 30); // Next window
      expect(verifyTOTP(secret, nextCode, time)).toBe(true);
    });

    it('rejects code from two windows ago', () => {
      const secret = generateSecret();
      const time = 1700000000;
      const oldCode = generateTOTP(secret, time - 60); // Two windows back
      expect(verifyTOTP(secret, oldCode, time)).toBe(false);
    });

    it('rejects incorrect code', () => {
      const secret = generateSecret();
      const time = 1700000000;
      expect(verifyTOTP(secret, '000000', time)).toBe(false);
    });

    it('rejects code with wrong secret', () => {
      const secret1 = generateSecret();
      const secret2 = generateSecret();
      const time = 1700000000;
      const code = generateTOTP(secret1, time);
      expect(verifyTOTP(secret2, code, time)).toBe(false);
    });
  });

  describe('generateOtpAuthUri', () => {
    it('generates valid otpauth URI format', () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const email = 'user@example.com';
      const uri = generateOtpAuthUri(secret, email);

      expect(uri).toContain('otpauth://totp/');
      expect(uri).toContain(encodeURIComponent(email));
      expect(uri).toContain(`secret=${secret}`);
      expect(uri).toContain('issuer=MeshSOS');
      expect(uri).toContain('algorithm=SHA1');
      expect(uri).toContain('digits=6');
      expect(uri).toContain('period=30');
    });

    it('uses custom issuer when provided', () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const uri = generateOtpAuthUri(secret, 'user@example.com', 'CustomIssuer');
      expect(uri).toContain('issuer=CustomIssuer');
    });

    it('encodes special characters in email', () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const email = 'user+test@example.com';
      const uri = generateOtpAuthUri(secret, email);
      expect(uri).toContain(encodeURIComponent(email));
    });
  });

  describe('PRIVILEGED_ROLES', () => {
    it('contains exactly dispatcher, supervisor, administrator', () => {
      expect([...PRIVILEGED_ROLES]).toEqual(['dispatcher', 'supervisor', 'administrator']);
    });
  });

  describe('TOTP RFC compliance', () => {
    it('handles known test vector (RFC 6238 appendix B - SHA1)', () => {
      // RFC 6238 test vector: secret = "12345678901234567890" (ASCII)
      // At time 59 (counter 1), expected TOTP with SHA1/6 digits = 287082
      const secret = base32Encode(Buffer.from('12345678901234567890'));
      const code = generateTOTP(secret, 59);
      expect(code).toBe('287082');
    });
  });
});
