import { useState, useEffect, useCallback } from 'react';
import type { LocalProfile, AccessibilityPreferences } from '@meshsos/shared';
import { profileRepository } from '../../db/profile-repository';

/**
 * Default accessibility preferences (all disabled).
 */
const DEFAULT_ACCESSIBILITY: AccessibilityPreferences = {
  largeText: false,
  highContrast: false,
  reducedMotion: false,
  screenReaderOptimized: false,
};

/**
 * Default empty profile used when no saved profile exists.
 */
const DEFAULT_PROFILE: LocalProfile = {
  name: null,
  language: 'en',
  emergencyContact: null,
  householdSize: null,
  accessibility: { ...DEFAULT_ACCESSIBILITY },
};

/**
 * Optional user profile configuration screen.
 * Allows survivors to save local preferences without login.
 * Persists to IndexedDB via profileRepository.
 *
 * Requirements: 13.1, 13.2, 13.3
 */
export function ProfileScreen() {
  const [name, setName] = useState('');
  const [language, setLanguage] = useState<'en' | 'hi'>('en');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [householdSize, setHouseholdSize] = useState('');
  const [accessibility, setAccessibility] = useState<AccessibilityPreferences>({
    ...DEFAULT_ACCESSIBILITY,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Load existing profile on mount
  useEffect(() => {
    async function loadProfile() {
      try {
        const existing = await profileRepository.get();
        if (existing) {
          setName(existing.name ?? '');
          setLanguage(existing.language);
          setEmergencyContact(existing.emergencyContact ?? '');
          setHouseholdSize(
            existing.householdSize != null
              ? String(existing.householdSize)
              : ''
          );
          setAccessibility(existing.accessibility ?? { ...DEFAULT_ACCESSIBILITY });
        }
      } finally {
        setLoading(false);
      }
    }
    loadProfile();
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSuccessMessage(null);

    const profile: LocalProfile = {
      name: name.trim() || null,
      language,
      emergencyContact: emergencyContact.trim() || null,
      householdSize: householdSize
        ? Math.max(1, Number.isNaN(parseInt(householdSize, 10)) ? 1 : parseInt(householdSize, 10))
        : null,
      accessibility,
    };

    try {
      await profileRepository.save(profile);
      setSuccessMessage('Profile saved successfully');
    } finally {
      setSaving(false);
    }
  }, [name, language, emergencyContact, householdSize, accessibility]);

  const toggleAccessibility = useCallback(
    (key: keyof AccessibilityPreferences) => {
      setAccessibility((prev) => ({ ...prev, [key]: !prev[key] }));
    },
    []
  );

  if (loading) {
    return (
      <div
        className="flex items-center justify-center min-h-screen"
        aria-busy="true"
        aria-label="Loading profile"
        data-testid="profile-loading"
      >
        <p className="text-lg text-gray-600">Loading profile...</p>
      </div>
    );
  }

  return (
    <div
      className="max-w-lg mx-auto p-4"
      role="region"
      aria-label="User profile configuration"
    >
      <h1 className="text-2xl font-bold mb-2">Profile Settings</h1>
      <p className="text-sm text-gray-600 mb-6">
        Optional configuration — stored locally on this device only. No login required.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
        noValidate
        className="space-y-5"
        aria-label="Profile form"
      >
        {/* Name */}
        <div>
          <label htmlFor="profile-name" className="block text-sm font-medium text-gray-700 mb-1">
            Name
          </label>
          <input
            id="profile-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name (optional)"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Language */}
        <div>
          <label htmlFor="profile-language" className="block text-sm font-medium text-gray-700 mb-1">
            Language
          </label>
          <select
            id="profile-language"
            value={language}
            onChange={(e) => setLanguage(e.target.value as 'en' | 'hi')}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="en">English</option>
            <option value="hi">Hindi</option>
          </select>
        </div>

        {/* Emergency Contact */}
        <div>
          <label htmlFor="profile-emergency-contact" className="block text-sm font-medium text-gray-700 mb-1">
            Emergency Contact Phone
          </label>
          <input
            id="profile-emergency-contact"
            type="tel"
            value={emergencyContact}
            onChange={(e) => setEmergencyContact(e.target.value)}
            placeholder="+91 XXXXX XXXXX"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Household Size */}
        <div>
          <label htmlFor="profile-household-size" className="block text-sm font-medium text-gray-700 mb-1">
            Household Size
          </label>
          <input
            id="profile-household-size"
            type="number"
            min="1"
            value={householdSize}
            onChange={(e) => setHouseholdSize(e.target.value)}
            placeholder="Number of people in household"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Accessibility Preferences */}
        <fieldset>
          <legend className="text-sm font-medium text-gray-700 mb-2">
            Accessibility Preferences
          </legend>
          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={accessibility.largeText}
                onChange={() => toggleAccessibility('largeText')}
                className="w-4 h-4"
              />
              <span>Large Text</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={accessibility.highContrast}
                onChange={() => toggleAccessibility('highContrast')}
                className="w-4 h-4"
              />
              <span>High Contrast</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={accessibility.reducedMotion}
                onChange={() => toggleAccessibility('reducedMotion')}
                className="w-4 h-4"
              />
              <span>Reduced Motion</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={accessibility.screenReaderOptimized}
                onChange={() => toggleAccessibility('screenReaderOptimized')}
                className="w-4 h-4"
              />
              <span>Screen Reader Optimized</span>
            </label>
          </div>
        </fieldset>

        {/* Save Button */}
        <button
          type="submit"
          disabled={saving}
          className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold rounded-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </form>

      {/* Success Message */}
      {successMessage && (
        <div
          role="status"
          aria-live="polite"
          data-testid="success-message"
          className="mt-4 p-3 bg-green-100 text-green-800 rounded-md text-center font-medium"
        >
          {successMessage}
        </div>
      )}
    </div>
  );
}
