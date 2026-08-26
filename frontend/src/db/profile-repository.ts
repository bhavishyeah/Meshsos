import type { LocalProfile } from '@meshsos/shared';
import { db } from './index';

/**
 * Repository for managing the local user profile in IndexedDB.
 * Only one profile record exists at a time.
 */
export const profileRepository = {
  /**
   * Retrieve the stored profile.
   * Returns undefined if no profile has been saved yet.
   */
  async get(): Promise<LocalProfile | undefined> {
    const record = await db.profile.toCollection().first();
    if (!record) return undefined;
    // Strip the internal id field before returning
    const { id: _id, ...profile } = record;
    return profile as LocalProfile;
  },

  /**
   * Save or update the user profile.
   * Uses a transaction to ensure atomicity - clears existing and writes new.
   * Retries once on failure as per requirement 3.5.
   */
  async save(profile: LocalProfile): Promise<void> {
    const doSave = async () => {
      await db.transaction('rw', db.profile, async () => {
        await db.profile.clear();
        await db.profile.add(profile as LocalProfile & { id?: string });
      });
    };

    try {
      await doSave();
    } catch (error) {
      // Single retry on failure
      await doSave();
    }
  },
};
