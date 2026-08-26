import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAccessibility } from './useAccessibility';
import { profileRepository } from '../db/profile-repository';
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

vi.mock('../db/profile-repository', () => ({
  profileRepository: {
    get: vi.fn(),
    save: vi.fn(),
  },
}));

const mockedGet = vi.mocked(profileRepository.get);

describe('useAccessibility', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.documentElement;
    root.style.fontSize = '';
    root.className = '';
    mockedGet.mockReset();
  });

  afterEach(() => {
    root.style.fontSize = '';
    root.className = '';
  });

  it('should not modify DOM when no profile exists', async () => {
    mockedGet.mockResolvedValue(undefined);

    renderHook(() => useAccessibility());

    // Wait for async effect
    await vi.waitFor(() => {
      expect(mockedGet).toHaveBeenCalled();
    });

    expect(root.style.fontSize).toBe('');
    expect(root.classList.contains('high-contrast')).toBe(false);
    expect(root.classList.contains('reduced-motion')).toBe(false);
    expect(root.classList.contains('sr-optimized')).toBe(false);
  });

  it('should apply large text (125% font size) when enabled', async () => {
    mockedGet.mockResolvedValue(
      createProfile({
        accessibility: {
          largeText: true,
          highContrast: false,
          reducedMotion: false,
          screenReaderOptimized: false,
        },
      })
    );

    renderHook(() => useAccessibility());

    await vi.waitFor(() => {
      expect(root.style.fontSize).toBe('125%');
    });
  });

  it('should add high-contrast class when enabled', async () => {
    mockedGet.mockResolvedValue(
      createProfile({
        accessibility: {
          largeText: false,
          highContrast: true,
          reducedMotion: false,
          screenReaderOptimized: false,
        },
      })
    );

    renderHook(() => useAccessibility());

    await vi.waitFor(() => {
      expect(root.classList.contains('high-contrast')).toBe(true);
    });
  });

  it('should add reduced-motion class when enabled', async () => {
    mockedGet.mockResolvedValue(
      createProfile({
        accessibility: {
          largeText: false,
          highContrast: false,
          reducedMotion: true,
          screenReaderOptimized: false,
        },
      })
    );

    renderHook(() => useAccessibility());

    await vi.waitFor(() => {
      expect(root.classList.contains('reduced-motion')).toBe(true);
    });
  });

  it('should add sr-optimized class when screenReaderOptimized is enabled', async () => {
    mockedGet.mockResolvedValue(
      createProfile({
        accessibility: {
          largeText: false,
          highContrast: false,
          reducedMotion: false,
          screenReaderOptimized: true,
        },
      })
    );

    renderHook(() => useAccessibility());

    await vi.waitFor(() => {
      expect(root.classList.contains('sr-optimized')).toBe(true);
    });
  });

  it('should apply all accessibility preferences simultaneously', async () => {
    mockedGet.mockResolvedValue(
      createProfile({
        accessibility: {
          largeText: true,
          highContrast: true,
          reducedMotion: true,
          screenReaderOptimized: true,
        },
      })
    );

    renderHook(() => useAccessibility());

    await vi.waitFor(() => {
      expect(root.style.fontSize).toBe('125%');
      expect(root.classList.contains('high-contrast')).toBe(true);
      expect(root.classList.contains('reduced-motion')).toBe(true);
      expect(root.classList.contains('sr-optimized')).toBe(true);
    });
  });

  it('should remove classes when preferences are disabled', async () => {
    // Set up initial state with classes present
    root.classList.add('high-contrast', 'reduced-motion', 'sr-optimized');
    root.style.fontSize = '125%';

    mockedGet.mockResolvedValue(
      createProfile({
        accessibility: {
          largeText: false,
          highContrast: false,
          reducedMotion: false,
          screenReaderOptimized: false,
        },
      })
    );

    renderHook(() => useAccessibility());

    await vi.waitFor(() => {
      expect(root.style.fontSize).toBe('');
      expect(root.classList.contains('high-contrast')).toBe(false);
      expect(root.classList.contains('reduced-motion')).toBe(false);
      expect(root.classList.contains('sr-optimized')).toBe(false);
    });
  });
});
