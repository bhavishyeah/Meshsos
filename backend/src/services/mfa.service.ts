/**
 * MFA Service - TOTP-based Multi-Factor Authentication
 *
 * Implements RFC 6238 TOTP (Time-based One-Time Password) for privileged roles.
 * Privileged roles (Dispatcher, Supervisor, Administrator) must complete MFA verification
 * during login before being granted full access.
 *
 * Requirements: 37.2
 */

import crypto from 'node:crypto';
import { query } from '../db/index.js';

/** Roles that require MFA verification during login */
export const PRIVILEGED_ROLES = ['dispatcher', 'supervisor', 'administrator'] as const;

/** TOTP configuration */
const TOTP_CONFIG = {
  /** Time step in seconds (standard TOTP uses 30s) */
  period: 30,
  /** Number of digits in the generated code */
  digits: 6,
  /** Hash algorithm */
  algorithm: 'sha1' as const,
  /** Number of time windows to check (before and after current) for clock drift tolerance */
  window: 1,
  /** Issuer name for the OTP URI */
  issuer: 'MeshSOS',
};

/**
 * Checks if a given role is a privileged role requiring MFA.
 */
export function isPrivilegedRole(role: string): boolean {
  return (PRIVILEGED_ROLES as readonly string[]).includes(role);
}

/**
 * Generates a random base32-encoded secret for TOTP.
 * Uses 20 bytes (160 bits) of cryptographic randomness.
 */
export function generateSecret(): string {
  const buffer = crypto.randomBytes(20);
  return base32Encode(buffer);
}

/**
 * Generates an otpauth:// URI for use with authenticator apps (e.g., Google Authenticator).
 * This URI can be encoded into a QR code for easy setup.
 */
export function generateOtpAuthUri(
  secret: string,
  userEmail: string,
  issuer: string = TOTP_CONFIG.issuer
): string {
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedEmail = encodeURIComponent(userEmail);
  return `otpauth://totp/${encodedIssuer}:${encodedEmail}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=${TOTP_CONFIG.digits}&period=${TOTP_CONFIG.period}`;
}

/**
 * Generates a TOTP code for the given secret at the specified time.
 * If no time is provided, uses the current time.
 */
export function generateTOTP(secret: string, time?: number): string {
  const now = time ?? Math.floor(Date.now() / 1000);
  const counter = Math.floor(now / TOTP_CONFIG.period);
  return hotpGenerate(secret, counter);
}

/**
 * Verifies a TOTP code against the given secret.
 * Allows a configurable time window to account for clock drift.
 * Returns true if the code is valid within the time window.
 */
export function verifyTOTP(secret: string, code: string, time?: number): boolean {
  const now = time ?? Math.floor(Date.now() / 1000);
  const counter = Math.floor(now / TOTP_CONFIG.period);

  // Check current time step and surrounding windows for clock drift tolerance
  for (let i = -TOTP_CONFIG.window; i <= TOTP_CONFIG.window; i++) {
    const expectedCode = hotpGenerate(secret, counter + i);
    if (timingSafeEqual(code, expectedCode)) {
      return true;
    }
  }

  return false;
}

/**
 * Sets up MFA for a user: generates a secret, stores it in the database,
 * and returns the secret + OTP auth URI.
 */
export async function setupMFA(
  userId: string,
  userEmail: string
): Promise<{ secret: string; otpauthUri: string }> {
  const secret = generateSecret();
  const otpauthUri = generateOtpAuthUri(secret, userEmail);

  // Store the secret but don't enable MFA yet (user must verify a code first)
  await query(
    'UPDATE users SET mfa_secret = $1, updated_at = NOW() WHERE id = $2',
    [secret, userId]
  );

  return { secret, otpauthUri };
}

/**
 * Verifies MFA during login and enables MFA if this is the first verification.
 * Returns true if the code is valid.
 */
export async function verifyMFA(userId: string, code: string): Promise<boolean> {
  const result = await query<{ mfa_secret: string | null; mfa_enabled: boolean }>(
    'SELECT mfa_secret, mfa_enabled FROM users WHERE id = $1',
    [userId]
  );

  if (result.rows.length === 0) {
    return false;
  }

  const { mfa_secret, mfa_enabled } = result.rows[0];

  if (!mfa_secret) {
    return false;
  }

  const isValid = verifyTOTP(mfa_secret, code);

  if (isValid && !mfa_enabled) {
    // First successful verification — enable MFA for this user
    await query(
      'UPDATE users SET mfa_enabled = true, updated_at = NOW() WHERE id = $1',
      [userId]
    );
  }

  return isValid;
}

/**
 * Checks if a user requires MFA verification (is a privileged role with MFA configured).
 */
export async function requiresMFA(userId: string): Promise<boolean> {
  const result = await query<{ role: string; mfa_enabled: boolean; mfa_secret: string | null }>(
    'SELECT role, mfa_enabled, mfa_secret FROM users WHERE id = $1',
    [userId]
  );

  if (result.rows.length === 0) {
    return false;
  }

  const { role, mfa_enabled } = result.rows[0];

  // Privileged roles always require MFA
  // If MFA is enabled, they must verify. If not enabled yet, they should be prompted to set it up.
  return isPrivilegedRole(role) && mfa_enabled;
}

/**
 * Checks if a privileged user still needs to set up MFA (has role but no MFA configured).
 */
export async function needsMFASetup(userId: string): Promise<boolean> {
  const result = await query<{ role: string; mfa_enabled: boolean; mfa_secret: string | null }>(
    'SELECT role, mfa_enabled, mfa_secret FROM users WHERE id = $1',
    [userId]
  );

  if (result.rows.length === 0) {
    return false;
  }

  const { role, mfa_enabled, mfa_secret } = result.rows[0];
  return isPrivilegedRole(role) && !mfa_enabled && !mfa_secret;
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * HOTP (HMAC-based One-Time Password) generation per RFC 4226.
 */
function hotpGenerate(secret: string, counter: number): string {
  const secretBuffer = base32Decode(secret);
  const counterBuffer = Buffer.alloc(8);
  // Write counter as big-endian 64-bit integer
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac(TOTP_CONFIG.algorithm, secretBuffer);
  hmac.update(counterBuffer);
  const digest = hmac.digest();

  // Dynamic truncation per RFC 4226
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  const otp = binary % Math.pow(10, TOTP_CONFIG.digits);
  return otp.toString().padStart(TOTP_CONFIG.digits, '0');
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Base32 encoding (RFC 4648) for TOTP secrets.
 */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

export function base32Decode(encoded: string): Buffer {
  const cleaned = encoded.toUpperCase().replace(/=+$/, '');
  const output: number[] = [];
  let bits = 0;
  let value = 0;

  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx === -1) {
      throw new Error(`Invalid base32 character: ${cleaned[i]}`);
    }
    value = (value << 5) | idx;
    bits += 5;

    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(output);
}
