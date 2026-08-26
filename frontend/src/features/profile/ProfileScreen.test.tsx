import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

function createMockProfile(overrides: Partial<LocalProfile> = {}): LocalProfile {
  return {
    name: 'Aarav Sharma',
    language: 'en',
    emergencyContact: '+919876543210',
    householdSize: 4,
    accessibility: {
      largeText: false,
      highContrast: false,
      reducedMotion: false,
      screenReaderOptimized: false,
    },
    ...overrides,
  };
}

describe('ProfileScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGet.mockResolvedValue(undefined);
    mockedSave.mockResolvedValue(undefined);
  });

  describe('Empty state (no existing profile)', () => {
    it('renders the profile form with empty fields when no profile exists', async () => {
      render(<ProfileScreen />);

      await waitFor(() => {
        expect(screen.queryByTestId('profile-loading')).not.toBeInTheDocument();
      });

      expect(screen.getByLabelText('Name')).toHaveValue('');
      expect(screen.getByLabelText('Language')).toHaveValue('en');
      expect(screen.getByLabelText('Emergency Contact Phone')).toHaveValue('');
      expect(screen.getByLabelText('Household Size')).toHaveValue(null);
    });

    it('displays optional configuration notice', async () => {
      render(<ProfileScreen />);

      await waitFor(() => {
        expect(screen.queryByTestId('profile-loading')).not.toBeInTheDocument();
      });

      expect(
        screen.getByText(/optional configuration/i)
      ).toBeInTheDocument();
      expect(
        screen.getByText(/no login required/i)
      ).toBeInTheDocument();
    });

    it('renders all accessibility checkboxes unchecked', async () => {
      render(<ProfileScreen />);

      await waitFor(() => {
        expect(screen.queryByTestId('profile-loading')).not.toBeInTheDocument();
      });

      expect(screen.getByLabelText('Large Text')).not.toBeChecked();
      expect(screen.getByLabelText('High Contrast')).not.toBeChecked();
      expect(screen.getByLabelText('Reduced Motion')).not.toBeChecked();
      expect(screen.getByLabelText('Screen Reader Optimized')).not.toBeChecked();
    });
  });

  describe('Loading existing profile', () => {
    it('populates form fields with existing profile data', async () => {
      const profile = createMockProfile({
        name: 'Priya Patel',
        language: 'hi',
        emergencyContact: '+911234567890',
        householdSize: 5,
        accessibility: {
          largeText: true,
          highContrast: false,
          reducedMotion: true,
          screenReaderOptimized: false,
        },
      });
      mockedGet.mockResolvedValue(profile);

      render(<ProfileScreen />);

      await waitFor(() => {
        expect(screen.getByLabelText('Name')).toHaveValue('Priya Patel');
      });

      expect(screen.getByLabelText('Language')).toHaveValue('hi');
      expect(screen.getByLabelText('Emergency Contact Phone')).toHaveValue('+911234567890');
      expect(screen.getByLabelText('Household Size')).toHaveValue(5);
      expect(screen.getByLabelText('Large Text')).toBeChecked();
      expect(screen.getByLabelText('High Contrast')).not.toBeChecked();
      expect(screen.getByLabelText('Reduced Motion')).toBeChecked();
      expect(screen.getByLabelText('Screen Reader Optimized')).not.toBeChecked();
    });

    it('handles profile with null optional fields', async () => {
      const profile = createMockProfile({
        name: null,
        emergencyContact: null,
        householdSize: null,
      });
      mockedGet.mockResolvedValue(profile);

      render(<ProfileScreen />);

      await waitFor(() => {
        expect(screen.queryByTestId('profile-loading')).not.toBeInTheDocument();
      });

      expect(screen.getByLabelText('Name')).toHaveValue('');
      expect(screen.getByLabelText('Emergency Contact Phone')).toHaveValue('');
      expect(screen.getByLabelText('Household Size')).toHaveValue(null);
    });
  });

  describe('Saving profile', () => {
    it('saves form data via profileRepository.save()', async () => {
      render(<ProfileScreen />);

      await waitFor(() => {
        expect(screen.queryByTestId('profile-loading')).not.toBeInTheDocument();
      });

      fireEvent.change(screen.getByLabelText('Name'), {
        target: { value: 'Vikram Singh' },
      });
      fireEvent.change(screen.getByLabelText('Language'), {
        target: { value: 'hi' },
      });
      fireEvent.change(screen.getByLabelText('Emergency Contact Phone'), {
        target: { value: '+919999888877' },
      });
      fireEvent.change(screen.getByLabelText('Household Size'), {
        target: { value: '3' },
      });
      fireEvent.click(screen.getByLabelText('Large Text'));

      fireEvent.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(mockedSave).toHaveBeenCalledWith({
          name: 'Vikram Singh',
          language: 'hi',
          emergencyContact: '+919999888877',
          householdSize: 3,
          accessibility: {
            largeText: true,
            highContrast: false,
            reducedMotion: false,
            screenReaderOptimized: false,
          },
        });
      });
    });

    it('displays success message after saving', async () => {
      render(<ProfileScreen />);

      await waitFor(() => {
        expect(screen.queryByTestId('profile-loading')).not.toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(screen.getByTestId('success-message')).toBeInTheDocument();
        expect(screen.getByText('Profile saved successfully')).toBeInTheDocument();
      });
    });

    it('saves null for empty optional fields', async () => {
      render(<ProfileScreen />);

      await waitFor(() => {
        expect(screen.queryByTestId('profile-loading')).not.toBeInTheDocument();
      });

      // Leave all fields empty, just submit
      fireEvent.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(mockedSave).toHaveBeenCalledWith({
          name: null,
          language: 'en',
          emergencyContact: null,
          householdSize: null,
          accessibility: {
            largeText: false,
            highContrast: false,
            reducedMotion: false,
            screenReaderOptimized: false,
          },
        });
      });
    });

    it('enforces minimum household size of 1', async () => {
      render(<ProfileScreen />);

      await waitFor(() => {
        expect(screen.queryByTestId('profile-loading')).not.toBeInTheDocument();
      });

      const input = screen.getByLabelText('Household Size');
      fireEvent.change(input, { target: { value: '0' } });

      const saveButton = screen.getByRole('button', { name: /save/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockedSave).toHaveBeenCalled();
      });

      const savedProfile = mockedSave.mock.calls[0][0];
      expect(savedProfile.householdSize).toBe(1);
    });
  });

  describe('Accessibility', () => {
    it('has accessible labels for all form fields', async () => {
      render(<ProfileScreen />);

      await waitFor(() => {
        expect(screen.queryByTestId('profile-loading')).not.toBeInTheDocument();
      });

      expect(screen.getByLabelText('Name')).toBeInTheDocument();
      expect(screen.getByLabelText('Language')).toBeInTheDocument();
      expect(screen.getByLabelText('Emergency Contact Phone')).toBeInTheDocument();
      expect(screen.getByLabelText('Household Size')).toBeInTheDocument();
      expect(screen.getByLabelText('Large Text')).toBeInTheDocument();
      expect(screen.getByLabelText('High Contrast')).toBeInTheDocument();
      expect(screen.getByLabelText('Reduced Motion')).toBeInTheDocument();
      expect(screen.getByLabelText('Screen Reader Optimized')).toBeInTheDocument();
    });

    it('uses a form element with proper region aria-label', async () => {
      render(<ProfileScreen />);

      await waitFor(() => {
        expect(screen.queryByTestId('profile-loading')).not.toBeInTheDocument();
      });

      expect(screen.getByRole('region', { name: /user profile configuration/i })).toBeInTheDocument();
      expect(screen.getByRole('form', { name: /profile form/i })).toBeInTheDocument();
    });
  });
});
