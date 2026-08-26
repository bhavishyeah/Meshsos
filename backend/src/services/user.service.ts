/**
 * User Management Service for MeshSOS.
 *
 * Handles creating user accounts (admin-only) and listing users.
 * Passwords are hashed with bcrypt (cost factor 12) before storage.
 */

import bcrypt from 'bcrypt';
import { query } from '../db/index.js';

const BCRYPT_ROUNDS = 12;

const VALID_ROLES = [
  'administrator',
  'dispatcher',
  'supervisor',
  'responder',
  'auditor',
] as const;

export type UserRole = (typeof VALID_ROLES)[number];

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  mfa_enabled: boolean;
  created_at: Date;
}

export class UserServiceError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'UserServiceError';
    this.statusCode = statusCode;
  }
}

/**
 * Validate that the role is one of the allowed values for admin-created users.
 */
function validateRole(role: string): asserts role is UserRole {
  if (!VALID_ROLES.includes(role as UserRole)) {
    throw new UserServiceError(
      `Invalid role "${role}". Must be one of: ${VALID_ROLES.join(', ')}`,
      400
    );
  }
}

/**
 * Validate password meets minimum requirements.
 */
function validatePassword(password: string): void {
  if (!password || password.length < 8) {
    throw new UserServiceError(
      'Password must be at least 8 characters long',
      400
    );
  }
}

/**
 * Create a new user account.
 *
 * Hashes the password with bcrypt (12 rounds), validates email uniqueness,
 * and inserts the user record.
 */
export async function createUser(
  name: string,
  email: string,
  password: string,
  role: string
): Promise<UserRow> {
  // Validate inputs
  validateRole(role);
  validatePassword(password);

  if (!email || !email.includes('@')) {
    throw new UserServiceError('A valid email address is required', 400);
  }

  if (!name || name.trim().length === 0) {
    throw new UserServiceError('Name is required', 400);
  }

  // Check email uniqueness
  const existing = await query<{ id: string }>(
    'SELECT id FROM users WHERE email = $1',
    [email]
  );

  if (existing.rows.length > 0) {
    throw new UserServiceError('A user with this email already exists', 409);
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // Insert user
  const result = await query<UserRow>(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, email, role, mfa_enabled, created_at`,
    [name.trim(), email.toLowerCase().trim(), passwordHash, role]
  );

  return result.rows[0];
}

/**
 * List all users ordered by creation date (newest first).
 *
 * Returns a safe subset of user fields (no password hash or MFA secrets).
 */
export async function listUsers(): Promise<UserRow[]> {
  const result = await query<UserRow>(
    `SELECT id, name, email, role, mfa_enabled, created_at
     FROM users
     ORDER BY created_at DESC`
  );

  return result.rows;
}
