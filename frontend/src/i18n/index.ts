import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import hi from './hi.json';
import { profileRepository } from '../db/profile-repository';

const resources = {
  en: { translation: en },
  hi: { translation: hi },
};

export const SUPPORTED_LANGUAGES = ['en', 'hi'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

i18n.use(initReactI18next).init({
  resources,
  lng: 'en',
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
});

/**
 * Load the user's language preference from their local profile
 * and apply it to i18next. Called on app startup.
 */
export async function applyLanguageFromProfile(): Promise<void> {
  const profile = await profileRepository.get();
  if (profile?.language) {
    await i18n.changeLanguage(profile.language);
  }
}

export default i18n;
