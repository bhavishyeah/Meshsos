import { useState } from 'react';
import { sosRepository } from '../../db/sos-repository';

/**
 * Situation type options available for selection.
 */
export const SITUATION_TYPES = [
  'Trapped',
  'Injured',
  'Stranded',
  'Threatened',
  'Missing',
  'Other',
] as const;

export type SituationType = (typeof SITUATION_TYPES)[number];

/**
 * Data submitted from the additional information form.
 */
export interface AdditionalInfoData {
  peopleCount?: number;
  situationType?: string;
  description?: string;
}

/**
 * Props for the AdditionalInfoForm component.
 */
export interface AdditionalInfoFormProps {
  sosId: string;
  onSubmit?: (data: AdditionalInfoData) => void;
  onSkip?: () => void;
}

/** Maximum character limit for the description field */
export const DESCRIPTION_MAX_LENGTH = 200;

/** Minimum people count value */
export const PEOPLE_COUNT_MIN = 1;

/** Maximum people count value */
export const PEOPLE_COUNT_MAX = 100;

/**
 * Optional additional information form shown after SOS creation.
 * Allows survivors to provide supplemental details (people count, situation type, description)
 * to help responders prepare. All fields are optional and the form can be skipped entirely.
 *
 * Validates: Requirements 12.1, 12.2, 12.3
 */
export function AdditionalInfoForm({ sosId, onSubmit, onSkip }: AdditionalInfoFormProps) {
  const [peopleCount, setPeopleCount] = useState<string>('');
  const [situationType, setSituationType] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const characterCount = description.length;
  const isOverLimit = characterCount > DESCRIPTION_MAX_LENGTH;

  const handlePeopleCountChange = (value: string) => {
    // Allow empty or valid numeric input
    if (value === '') {
      setPeopleCount('');
      return;
    }
    const num = parseInt(value, 10);
    if (!isNaN(num)) {
      setPeopleCount(value);
    }
  };

  const handleDescriptionChange = (value: string) => {
    // Allow typing but enforce max length
    if (value.length <= DESCRIPTION_MAX_LENGTH) {
      setDescription(value);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    // Build the data payload — only include fields that have values
    const data: AdditionalInfoData = {};

    if (peopleCount !== '') {
      const count = parseInt(peopleCount, 10);
      if (count >= PEOPLE_COUNT_MIN && count <= PEOPLE_COUNT_MAX) {
        data.peopleCount = count;
      }
    }

    if (situationType !== '') {
      data.situationType = situationType;
    }

    if (description.trim() !== '') {
      data.description = description.trim();
    }

    try {
      // Update the SOS record in IndexedDB
      await sosRepository.update(sosId, {
        peopleCount: data.peopleCount ?? null,
        situationType: data.situationType ?? null,
        description: data.description ?? null,
      });

      onSubmit?.(data);
    } catch (err) {
      setError('Failed to save additional information. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkip = () => {
    onSkip?.();
  };

  return (
    <form
      onSubmit={handleSubmit}
      aria-labelledby="additional-info-heading"
      className="space-y-4 p-4"
      noValidate
    >
      <h2 id="additional-info-heading" className="text-lg font-semibold">
        Additional Information
      </h2>

      <p className="text-sm text-gray-600" aria-live="polite">
        This information is optional but helps responders. You can skip this.
      </p>

      {error && (
        <div role="alert" className="text-red-600 text-sm">
          {error}
        </div>
      )}

      {/* People Count */}
      <div className="space-y-1">
        <label htmlFor="people-count" className="block text-sm font-medium">
          Number of people
        </label>
        <input
          id="people-count"
          type="number"
          min={PEOPLE_COUNT_MIN}
          max={PEOPLE_COUNT_MAX}
          value={peopleCount}
          onChange={(e) => handlePeopleCountChange(e.target.value)}
          placeholder="How many people need help?"
          aria-describedby="people-count-hint"
          className="w-full border rounded px-3 py-2 min-h-[48px]"
          disabled={isSubmitting}
        />
        <span id="people-count-hint" className="text-xs text-gray-500">
          Between {PEOPLE_COUNT_MIN} and {PEOPLE_COUNT_MAX}
        </span>
      </div>

      {/* Situation Type */}
      <div className="space-y-1">
        <label htmlFor="situation-type" className="block text-sm font-medium">
          Situation type
        </label>
        <select
          id="situation-type"
          value={situationType}
          onChange={(e) => setSituationType(e.target.value)}
          aria-describedby="situation-type-hint"
          className="w-full border rounded px-3 py-2 min-h-[48px]"
          disabled={isSubmitting}
        >
          <option value="">Select a situation type</option>
          {SITUATION_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <span id="situation-type-hint" className="text-xs text-gray-500">
          Select the type of emergency situation
        </span>
      </div>

      {/* Description */}
      <div className="space-y-1">
        <label htmlFor="description" className="block text-sm font-medium">
          Description
        </label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => handleDescriptionChange(e.target.value)}
          placeholder="Briefly describe the situation..."
          maxLength={DESCRIPTION_MAX_LENGTH}
          rows={3}
          aria-describedby="description-counter"
          className="w-full border rounded px-3 py-2"
          disabled={isSubmitting}
        />
        <span
          id="description-counter"
          className={`text-xs ${isOverLimit ? 'text-red-600' : 'text-gray-500'}`}
          aria-live="polite"
          aria-atomic="true"
        >
          {characterCount}/{DESCRIPTION_MAX_LENGTH} characters
        </span>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={handleSkip}
          className="flex-1 border rounded px-4 py-2 min-h-[48px] min-w-[48px] text-gray-700"
          disabled={isSubmitting}
          aria-label="Skip additional information"
        >
          Skip
        </button>
        <button
          type="submit"
          className="flex-1 bg-blue-600 text-white rounded px-4 py-2 min-h-[48px] min-w-[48px] disabled:opacity-50"
          disabled={isSubmitting}
          aria-label="Save additional information"
        >
          {isSubmitting ? 'Saving...' : 'Save'}
        </button>
      </div>
    </form>
  );
}
