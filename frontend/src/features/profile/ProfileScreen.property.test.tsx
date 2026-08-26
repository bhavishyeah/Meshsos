/**
 * Property tests for Profile Input Validation (Property 18)
 *
 * **Validates: Requirements 13.3**
 *
 * Tests verify profile input validation rules:
 * 1. Language is always 'en' or 'hi' in the saved profile
 * 2. Household size >= 1 is preserved as-is
 * 3. Household size < 1 is clamped to 1
 * 4. Accessibility preferences are always boolean values
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ProfileScreen } from './ProfileScreen';
import type { LocalProfile } from '@meshsos/shared';

// Mock the profileRepository
vi.mock('../../db/profile-repository', () => ({
  profileRepository: {
    get: vi.fn(),
    save: vi.fn(),
  },
}));

import { profileRepository } from '../../db/profile-repository';

const mockedGet = vi.mocked(profileRepository.get);
const mockedSave = vi.mocked(profileRepository.save);

describe('Property 18: Profile Input Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGet.mockResolvedValue(undefined);
    mockedSave.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Language is always "en" or "hi" in the saved profile', () => {
    it('for any language value selected, the saved profile language is always "en" or "hi"', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('en', 'hi'),
          async (langValue) => {
            cleanup();
            vi.clearAllMocks();
            mockedGet.mockResolvedValue(undefined);
            mockedSave.mockResolvedValue(undefined);

            render(<ProfileScreen />);

            await waitFor(() => {
              expect(screen.queryByTestId('profile-loading')).not.toBeInTheDocument();
            });

            // Set the language via select
            fireEvent.change(screen.getByLabelText('Language'), {
              target: { value: langValue },
            });

            // Submit the form
            fireEvent.click(screen.getByRole('button', { name: /save/i }));

            await waitFor(() => {
              expect(mockedSave).toHaveBeenCalled();
            });

            const savedProfile = mockedSave.mock.calls[0][0] as LocalProfile;
            expect(['en', 'hi']).toContain(savedProfile.language);

            cleanup();
          }
        ),
        { numRuns: 20 }
      );
    });

    it('when loading any previously saved profile language, the form always saves "en" or "hi"', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('en' as const, 'hi' as const),
          fc.constantFrom('en' as const, 'hi' as const),
          async (initialLang, selectedLang) => {
            cleanup();
            vi.clearAllMocks();
            mockedGet.mockResolvedValue({
              name: null,
              language: initialLang,
              emergencyContact: null,
              householdSize: null,
              accessibility: {
                largeText: false,
                highContrast: false,
                reducedMotion: false,
                screenReaderOptimized: false,
              },
            });
            mockedSave.mockResolvedValue(undefined);

            render(<ProfileScreen />);

            await waitFor(() => {
              expect(screen.queryByTestId('profile-loading')).not.toBeInTheDocument();
            });

            // Change language to another valid value
            fireEvent.change(screen.getByLabelText('Language'), {
              target: { value: selectedLang },
            });

            // Submit
            fireEvent.click(screen.getByRole('button', { name: /save/i }));

            await waitFor(() => {
              expect(mockedSave).toHaveBeenCalled();
            });

            const savedProfile = mockedSave.mock.calls[0][0] as LocalProfile;
            // The profile's language must always be one of the valid options
            expect(['en', 'hi']).toContain(savedProfile.language);
            expect(savedProfile.language).toBe(selectedLang);

            cleanup();
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  describe('Household size >= 1 is preserved as-is', () => {
    it('for any household size >= 1, the saved value matches the input', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 99 }),
          async (size) => {
            cleanup();
            vi.clearAllMocks();
            mockedGet.mockResolvedValue(undefined);
            mockedSave.mockResolvedValue(undefined);

            render(<ProfileScreen />);

            await waitFor(() => {
              expect(screen.queryByTestId('profile-loading')).not.toBeInTheDocument();
            });

            fireEvent.change(screen.getByLabelText('Household Size'), {
              target: { value: String(size) },
            });

            fireEvent.click(screen.getByRole('button', { name: /save/i }));

            await waitFor(() => {
              expect(mockedSave).toHaveBeenCalled();
            });

            const savedProfile = mockedSave.mock.calls[0][0] as LocalProfile;
            expect(savedProfile.householdSize).toBe(size);

            cleanup();
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  describe('Household size < 1 is clamped to 1', () => {
    it('for any household size < 1, the saved value is clamped to 1', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: -1000, max: 0 }),
          async (size) => {
            cleanup();
            vi.clearAllMocks();
            mockedGet.mockResolvedValue(undefined);
            mockedSave.mockResolvedValue(undefined);

            render(<ProfileScreen />);

            await waitFor(() => {
              expect(screen.queryByTestId('profile-loading')).not.toBeInTheDocument();
            });

            fireEvent.change(screen.getByLabelText('Household Size'), {
              target: { value: String(size) },
            });

            fireEvent.click(screen.getByRole('button', { name: /save/i }));

            await waitFor(() => {
              expect(mockedSave).toHaveBeenCalled();
            });

            const savedProfile = mockedSave.mock.calls[0][0] as LocalProfile;
            expect(savedProfile.householdSize).toBe(1);

            cleanup();
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  describe('Accessibility preferences are always boolean values', () => {
    it('for any combination of toggled accessibility prefs, all values are booleans', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            largeText: fc.boolean(),
            highContrast: fc.boolean(),
            reducedMotion: fc.boolean(),
            screenReaderOptimized: fc.boolean(),
          }),
          async (prefs) => {
            cleanup();
            vi.clearAllMocks();
            mockedGet.mockResolvedValue(undefined);
            mockedSave.mockResolvedValue(undefined);

            render(<ProfileScreen />);

            await waitFor(() => {
              expect(screen.queryByTestId('profile-loading')).not.toBeInTheDocument();
            });

            // Toggle each checkbox to match the desired state
            // All start as false (unchecked), toggle the ones that should be true
            if (prefs.largeText) {
              fireEvent.click(screen.getByLabelText('Large Text'));
            }
            if (prefs.highContrast) {
              fireEvent.click(screen.getByLabelText('High Contrast'));
            }
            if (prefs.reducedMotion) {
              fireEvent.click(screen.getByLabelText('Reduced Motion'));
            }
            if (prefs.screenReaderOptimized) {
              fireEvent.click(screen.getByLabelText('Screen Reader Optimized'));
            }

            fireEvent.click(screen.getByRole('button', { name: /save/i }));

            await waitFor(() => {
              expect(mockedSave).toHaveBeenCalled();
            });

            const savedProfile = mockedSave.mock.calls[0][0] as LocalProfile;
            const a = savedProfile.accessibility;

            // All accessibility values must be booleans
            expect(typeof a.largeText).toBe('boolean');
            expect(typeof a.highContrast).toBe('boolean');
            expect(typeof a.reducedMotion).toBe('boolean');
            expect(typeof a.screenReaderOptimized).toBe('boolean');

            // Values match the toggled state
            expect(a.largeText).toBe(prefs.largeText);
            expect(a.highContrast).toBe(prefs.highContrast);
            expect(a.reducedMotion).toBe(prefs.reducedMotion);
            expect(a.screenReaderOptimized).toBe(prefs.screenReaderOptimized);

            cleanup();
          }
        ),
        { numRuns: 20 }
      );
    });
  });
});
