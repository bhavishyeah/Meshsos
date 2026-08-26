-- Migration: 002_mfa_secret
-- Description: Add MFA secret column to users table for TOTP-based multi-factor authentication
-- Requirements: 37.2

-- Add mfa_secret column to store the TOTP shared secret (base32-encoded)
-- Only populated when a user sets up MFA
ALTER TABLE users ADD COLUMN mfa_secret VARCHAR(64);
