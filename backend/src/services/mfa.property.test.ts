import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { isPrivilegedRole, PRIVILEGED_ROLES } from './mfa.service.js';

/**
 * Property 36: MFA Requirement for Privileged Roles
 *
 * For any authentication attempt by a user with a given role, the Backend SHALL
 * require multi-factor authentication if and only if the role is Dispatcher,
 * Supervisor, or Administrator.
 *
 * **Validates: Requirements 37.2**
 */

/** All system roles defined in the platform */
const ALL_ROLES = ['survivor', 'responder', 'dispatcher', 'supervisor', 'administrator', 'auditor'] as const;

/** Roles that do NOT require MFA */
const NON_PRIVILEGED_ROLES = ['survivor', 'responder', 'auditor'] as const;

// Arbitraries
const allRoleArb = fc.constantFrom(...ALL_ROLES);
const privilegedRoleArb = fc.constantFrom(...PRIVILEGED_ROLES);
const nonPrivilegedRoleArb = fc.constantFrom(...NON_PRIVILEGED_ROLES);

describe('Property 36: MFA Requirement for Privileged Roles', () => {
  describe('isPrivilegedRole correctly identifies MFA requirement by role', () => {
    it('for any role from the full set, isPrivilegedRole returns true iff the role is in PRIVILEGED_ROLES', () => {
      fc.assert(
        fc.property(allRoleArb, (role) => {
          const expected = (PRIVILEGED_ROLES as readonly string[]).includes(role);
          const actual = isPrivilegedRole(role);
          expect(actual).toBe(expected);
        }),
        { numRuns: 500 }
      );
    });
  });

  describe('MFA is required for all privileged roles', () => {
    it('for any privileged role (dispatcher, supervisor, administrator), isPrivilegedRole returns true', () => {
      fc.assert(
        fc.property(privilegedRoleArb, (role) => {
          expect(isPrivilegedRole(role)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('MFA is NOT required for non-privileged roles', () => {
    it('for any non-privileged role (survivor, responder, auditor), isPrivilegedRole returns false', () => {
      fc.assert(
        fc.property(nonPrivilegedRoleArb, (role) => {
          expect(isPrivilegedRole(role)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('MFA requirement is deterministic', () => {
    it('for any role, calling isPrivilegedRole twice returns the same result', () => {
      fc.assert(
        fc.property(allRoleArb, (role) => {
          const first = isPrivilegedRole(role);
          const second = isPrivilegedRole(role);
          expect(first).toBe(second);
        }),
        { numRuns: 300 }
      );
    });
  });

  describe('arbitrary string roles are not privileged unless they match exactly', () => {
    it('for any randomly generated string that is not an exact privileged role name, isPrivilegedRole returns false', () => {
      const arbitraryStringArb = fc
        .string({ minLength: 1, maxLength: 30 })
        .filter((s) => !(PRIVILEGED_ROLES as readonly string[]).includes(s));

      fc.assert(
        fc.property(arbitraryStringArb, (role) => {
          expect(isPrivilegedRole(role)).toBe(false);
        }),
        { numRuns: 200 }
      );
    });
  });
});
