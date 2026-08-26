import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './index';
import { profileRepository } from './profile-repository';
import type { LocalProfile } from '@meshsos/shared';

function createProfile(overrides: Partial<LocalProfile> = {}): LocalProfile {
  return {
    name: 'Test User',
    language: 'en',
    emergencyContact: '+1234567890',
    householdSize: 3,
    accessibility: {
      largeText: false,
      highContrast: false,
      reducedMotion: false,
      screenReaderOptimized: false,
    },
    ...overrides,
  };
}

describe('ProfileRepository', () => {
  beforeEach(async () => {
    await db.profile.clear();
  });

  describe('get', () => {
    it('should return undefined when no profile exists', async () => {
      const result = await profileRepository.get();
      expect(result).toBeUndefined();
    });

    it('should return the stored profile', async () => {
      const profile = createProfile();
      await db.profile.add(profile as LocalProfile & { id?: string });

      const result = await profileRepository.get();
      expect(result).toBeDefined();
      expect(result!.name).toBe('Test User');
      expect(result!.language).toBe('en');
      expect(result!.emergencyContact).toBe('+1234567890');
      expect(result!.householdSize).toBe(3);
    });

    it('should not include the internal id field', async () => {
      const profile = createProfile();
      await db.profile.add(profile as LocalProfile & { id?: string });

      const result = await profileRepository.get();
      expect(result).not.toHaveProperty('id');
    });
  });

  describe('save', () => {
    it('should save a new profile', async () => {
      const profile = createProfile();
      await profileRepository.save(profile);

      const stored = await db.profile.toCollection().first();
      expect(stored).toBeDefined();
      expect(stored!.name).toBe('Test User');
    });

    it('should replace the existing profile on save', async () => {
      const profile1 = createProfile({ name: 'First User' });
      await profileRepository.save(profile1);

      const profile2 = createProfile({ name: 'Second User' });
      await profileRepository.save(profile2);

      const count = await db.profile.count();
      expect(count).toBe(1);

      const result = await profileRepository.get();
      expect(result!.name).toBe('Second User');
    });

    it('should preserve all profile fields', async () => {
      const profile = createProfile({
        name: 'Full Profile',
        language: 'hi',
        emergencyContact: '+9876543210',
        householdSize: 5,
        accessibility: {
          largeText: true,
          highContrast: true,
          reducedMotion: true,
          screenReaderOptimized: true,
        },
      });

      await profileRepository.save(profile);
      const result = await profileRepository.get();

      expect(result!.name).toBe('Full Profile');
      expect(result!.language).toBe('hi');
      expect(result!.emergencyContact).toBe('+9876543210');
      expect(result!.householdSize).toBe(5);
      expect(result!.accessibility.largeText).toBe(true);
      expect(result!.accessibility.highContrast).toBe(true);
      expect(result!.accessibility.reducedMotion).toBe(true);
      expect(result!.accessibility.screenReaderOptimized).toBe(true);
    });

    it('should handle profile with null optional fields', async () => {
      const profile = createProfile({
        name: null,
        emergencyContact: null,
        householdSize: null,
      });

      await profileRepository.save(profile);
      const result = await profileRepository.get();

      expect(result!.name).toBeNull();
      expect(result!.emergencyContact).toBeNull();
      expect(result!.householdSize).toBeNull();
    });
  });
});
