/**
 * Unit tests for UserService.
 *
 * Tests createUser validation, password hashing, email uniqueness,
 * and listUsers query.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database module
vi.mock('../db/index.js', () => ({
  query: vi.fn(),
  pool: { on: vi.fn() },
}));

// Mock bcrypt
vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn(),
  },
}));

import { createUser, listUsers, UserServiceError } from './user.service.js';
import { query } from '../db/index.js';
import bcrypt from 'bcrypt';

const mockQuery = vi.mocked(query);
const mockBcryptHash = vi.mocked(bcrypt.hash);

describe('UserService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createUser', () => {
    it('creates a user with valid inputs and returns the user row', async () => {
      // Mock: no existing user
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      // Mock: bcrypt hash
      mockBcryptHash.mockResolvedValueOnce('$2b$12$hashedpassword' as never);

      // Mock: insert user
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'user-uuid-1',
          name: 'Jane Doe',
          email: 'jane@example.com',
          role: 'dispatcher',
          mfa_enabled: false,
          created_at: new Date('2024-01-01'),
        }],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      const result = await createUser('Jane Doe', 'jane@example.com', 'securePass1', 'dispatcher');

      expect(result.id).toBe('user-uuid-1');
      expect(result.name).toBe('Jane Doe');
      expect(result.email).toBe('jane@example.com');
      expect(result.role).toBe('dispatcher');
      expect(result.mfa_enabled).toBe(false);

      // Verify bcrypt was called with 12 rounds
      expect(mockBcryptHash).toHaveBeenCalledWith('securePass1', 12);

      // Verify insert query used lowercase trimmed email
      const insertCall = mockQuery.mock.calls[1];
      expect(insertCall[1]).toEqual(['Jane Doe', 'jane@example.com', '$2b$12$hashedpassword', 'dispatcher']);
    });

    it('trims the name and lowercases the email', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      mockBcryptHash.mockResolvedValueOnce('$2b$12$hashed' as never);

      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'user-uuid-2',
          name: 'John Smith',
          email: 'john@example.com',
          role: 'responder',
          mfa_enabled: false,
          created_at: new Date('2024-01-01'),
        }],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      await createUser('  John Smith  ', '  John@Example.COM  ', 'password123', 'responder');

      const insertCall = mockQuery.mock.calls[1];
      expect(insertCall[1]).toEqual(['John Smith', 'john@example.com', '$2b$12$hashed', 'responder']);
    });

    it('throws UserServiceError for invalid role', async () => {
      await expect(createUser('Test', 'test@test.com', 'password123', 'superadmin'))
        .rejects.toThrow(UserServiceError);
      await expect(createUser('Test', 'test@test.com', 'password123', 'superadmin'))
        .rejects.toThrow('Invalid role');
    });

    it('throws UserServiceError for password shorter than 8 characters', async () => {
      await expect(createUser('Test', 'test@test.com', 'short', 'dispatcher'))
        .rejects.toThrow(UserServiceError);
      await expect(createUser('Test', 'test@test.com', 'short', 'dispatcher'))
        .rejects.toThrow('Password must be at least 8 characters');
    });

    it('throws UserServiceError for empty password', async () => {
      await expect(createUser('Test', 'test@test.com', '', 'dispatcher'))
        .rejects.toThrow('Password must be at least 8 characters');
    });

    it('throws UserServiceError for invalid email', async () => {
      await expect(createUser('Test', 'notanemail', 'password123', 'dispatcher'))
        .rejects.toThrow('A valid email address is required');
    });

    it('throws UserServiceError for empty email', async () => {
      await expect(createUser('Test', '', 'password123', 'dispatcher'))
        .rejects.toThrow('A valid email address is required');
    });

    it('throws UserServiceError for empty name', async () => {
      await expect(createUser('', 'test@test.com', 'password123', 'dispatcher'))
        .rejects.toThrow('Name is required');
    });

    it('throws UserServiceError for whitespace-only name', async () => {
      await expect(createUser('   ', 'test@test.com', 'password123', 'dispatcher'))
        .rejects.toThrow('Name is required');
    });

    it('throws UserServiceError when email already exists', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'existing-user' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      await expect(createUser('Test', 'taken@test.com', 'password123', 'dispatcher'))
        .rejects.toThrow('A user with this email already exists');
    });

    it('accepts all valid roles', async () => {
      const validRoles = ['administrator', 'dispatcher', 'supervisor', 'responder', 'auditor'];

      for (const role of validRoles) {
        vi.clearAllMocks();

        mockQuery.mockResolvedValueOnce({
          rows: [],
          rowCount: 0,
          command: 'SELECT',
          oid: 0,
          fields: [],
        });

        mockBcryptHash.mockResolvedValueOnce('$2b$12$hash' as never);

        mockQuery.mockResolvedValueOnce({
          rows: [{
            id: `user-${role}`,
            name: 'Test',
            email: `${role}@test.com`,
            role,
            mfa_enabled: false,
            created_at: new Date(),
          }],
          rowCount: 1,
          command: 'INSERT',
          oid: 0,
          fields: [],
        });

        const result = await createUser('Test', `${role}@test.com`, 'password123', role);
        expect(result.role).toBe(role);
      }
    });

    it('rejects survivor role (not allowed for admin-created users)', async () => {
      await expect(createUser('Test', 'test@test.com', 'password123', 'survivor'))
        .rejects.toThrow(UserServiceError);
    });
  });

  describe('listUsers', () => {
    it('returns all users ordered by created_at DESC', async () => {
      const users = [
        {
          id: 'user-2',
          name: 'Newer User',
          email: 'newer@test.com',
          role: 'dispatcher',
          mfa_enabled: true,
          created_at: new Date('2024-02-01'),
        },
        {
          id: 'user-1',
          name: 'Older User',
          email: 'older@test.com',
          role: 'responder',
          mfa_enabled: false,
          created_at: new Date('2024-01-01'),
        },
      ];

      mockQuery.mockResolvedValueOnce({
        rows: users,
        rowCount: 2,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await listUsers();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('user-2');
      expect(result[1].id).toBe('user-1');

      // Verify correct SQL was executed
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id, name, email, role, mfa_enabled, created_at')
      );
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC')
      );
    });

    it('returns empty array when no users exist', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await listUsers();

      expect(result).toEqual([]);
    });
  });

  describe('UserServiceError', () => {
    it('has correct name and status code', () => {
      const err = new UserServiceError('test error', 409);
      expect(err.name).toBe('UserServiceError');
      expect(err.message).toBe('test error');
      expect(err.statusCode).toBe(409);
    });

    it('defaults to 400 status code', () => {
      const err = new UserServiceError('bad request');
      expect(err.statusCode).toBe(400);
    });
  });
});
