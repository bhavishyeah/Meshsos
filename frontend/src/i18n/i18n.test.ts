import { describe, it, expect, beforeEach } from 'vitest';
import i18n, { applyLanguageFromProfile, SUPPORTED_LANGUAGES } from './index';
import { profileRepository } from '../db/profile-repository';
import type { LocalProfile } from '@meshsos/shared';

function createProfile(language: 'en' | 'hi'): LocalProfile {
  return {
    name: 'Test User',
    language,
    emergencyContact: null,
    householdSize: null,
    accessibility: {
      largeText: false,
      highContrast: false,
      reducedMotion: false,
      screenReaderOptimized: false,
    },
  };
}

describe('i18n', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('defaults to English', () => {
    expect(i18n.language).toBe('en');
  });

  it('supports switching to Hindi', async () => {
    await i18n.changeLanguage('hi');
    expect(i18n.language).toBe('hi');
  });

  it('translates keys in English', () => {
    expect(i18n.t('emergency.police')).toBe('Police/Rescue');
    expect(i18n.t('status.created')).toBe('Created');
    expect(i18n.t('system.offline')).toBe('You are offline');
    expect(i18n.t('connectivity.connected')).toBe('Connected');
  });

  it('translates keys in Hindi', async () => {
    await i18n.changeLanguage('hi');
    expect(i18n.t('emergency.police')).toBe('पुलिस/बचाव');
    expect(i18n.t('status.created')).toBe('बनाया गया');
    expect(i18n.t('system.offline')).toBe('आप ऑफ़लाइन हैं');
    expect(i18n.t('connectivity.connected')).toBe('जुड़ा हुआ');
  });

  it('falls back to English for unknown language', async () => {
    await i18n.changeLanguage('fr');
    expect(i18n.t('emergency.police')).toBe('Police/Rescue');
  });

  it('exports supported languages list', () => {
    expect(SUPPORTED_LANGUAGES).toEqual(['en', 'hi']);
  });

  describe('applyLanguageFromProfile', () => {
    it('applies Hindi when profile language is hi', async () => {
      await profileRepository.save(createProfile('hi'));
      await applyLanguageFromProfile();
      expect(i18n.language).toBe('hi');
    });

    it('keeps English when profile language is en', async () => {
      await profileRepository.save(createProfile('en'));
      await applyLanguageFromProfile();
      expect(i18n.language).toBe('en');
    });

    it('keeps default language when no profile exists', async () => {
      await applyLanguageFromProfile();
      expect(i18n.language).toBe('en');
    });
  });
});
