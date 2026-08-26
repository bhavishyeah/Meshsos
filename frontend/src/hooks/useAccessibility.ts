import { useEffect } from 'react';
import { profileRepository } from '../db/profile-repository';

/**
 * Hook that reads the user's accessibility preferences from their local profile
 * and applies them to the document root element.
 *
 * - largeText: increases base font size by 25%
 * - highContrast: adds 'high-contrast' class for high-contrast color scheme
 * - reducedMotion: adds 'reduced-motion' class to disable all CSS animations
 * - screenReaderOptimized: adds 'sr-optimized' class for screen reader hints
 *
 * Requirements: 16.1, 16.2, 16.3, 16.4
 */
export function useAccessibility() {
  useEffect(() => {
    async function applyPreferences() {
      const profile = await profileRepository.get();
      if (!profile) return;

      const root = document.documentElement;

      // Large Text: increase base font size by 25%
      if (profile.accessibility.largeText) {
        root.style.fontSize = '125%';
      } else {
        root.style.fontSize = '';
      }

      // High Contrast: apply high-contrast color scheme
      if (profile.accessibility.highContrast) {
        root.classList.add('high-contrast');
      } else {
        root.classList.remove('high-contrast');
      }

      // Reduced Motion: disable CSS animations
      if (profile.accessibility.reducedMotion) {
        root.classList.add('reduced-motion');
      } else {
        root.classList.remove('reduced-motion');
      }

      // Screen Reader Optimized: add hints for assistive tech
      if (profile.accessibility.screenReaderOptimized) {
        root.classList.add('sr-optimized');
      } else {
        root.classList.remove('sr-optimized');
      }
    }

    applyPreferences();
  }, []);
}
