import { useState, useCallback } from 'react';
import type { EmergencyType } from '@meshsos/shared';
import { createSOS } from '../../services/sos-creator.service';

/**
 * Emergency button configuration for the home screen.
 */
interface EmergencyButton {
  type: EmergencyType;
  label: string;
  colorClasses: string;
  icon: string;
}

const EMERGENCY_BUTTONS: EmergencyButton[] = [
  {
    type: 'police',
    label: 'Police / Rescue',
    colorClasses: 'bg-blue-700 hover:bg-blue-800 active:bg-blue-900',
    icon: '🚔',
  },
  {
    type: 'medical',
    label: 'Medical Help',
    colorClasses: 'bg-red-600 hover:bg-red-700 active:bg-red-800',
    icon: '🏥',
  },
  {
    type: 'food',
    label: 'Food / Water',
    colorClasses: 'bg-green-600 hover:bg-green-700 active:bg-green-800',
    icon: '🍲',
  },
  {
    type: 'childrenElderly',
    label: 'Children / Elderly',
    colorClasses: 'bg-purple-600 hover:bg-purple-700 active:bg-purple-800',
    icon: '👶',
  },
];

export interface HomeScreenProps {
  /** Called after SOS is successfully created, receives the SOS record ID */
  onSOSCreated?: (sosId: string) => void;
}

/**
 * Home screen with four large, accessible emergency type buttons.
 * Each button triggers SOS creation with the selected emergency type.
 *
 * Requirements: 1.1, 6.1, 6.2, 6.3
 */
export function HomeScreen({ onSOSCreated }: HomeScreenProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleEmergencyTap = useCallback(
    async (emergencyType: EmergencyType) => {
      if (isCreating) return;

      setIsCreating(true);
      setError(null);

      try {
        const result = await createSOS({ emergencyType });

        if (result.success && result.record) {
          // Trigger haptic feedback where supported
          if (navigator.vibrate) {
            navigator.vibrate(100);
          }
          onSOSCreated?.(result.record.id);
        } else {
          setError(result.error ?? 'Failed to create SOS');
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'An unexpected error occurred'
        );
      } finally {
        setIsCreating(false);
      }
    },
    [isCreating, onSOSCreated]
  );

  return (
    <div
      className="grid grid-cols-2 grid-rows-2 gap-3 p-3 h-screen w-full"
      role="region"
      aria-label="Emergency SOS buttons"
    >
      {EMERGENCY_BUTTONS.map((button) => (
        <button
          key={button.type}
          type="button"
          role="button"
          aria-label={`Create ${button.label} emergency SOS`}
          disabled={isCreating}
          onClick={() => handleEmergencyTap(button.type)}
          className={`
            flex flex-col items-center justify-center
            min-h-[48px] min-w-[48px]
            rounded-2xl shadow-lg
            text-white font-bold text-xl
            transition-colors duration-150
            focus:outline-none focus:ring-4 focus:ring-white/50
            disabled:opacity-60 disabled:cursor-not-allowed
            select-none
            ${button.colorClasses}
          `}
        >
          <span className="text-4xl mb-2" aria-hidden="true">
            {button.icon}
          </span>
          <span className="text-lg sm:text-xl md:text-2xl font-bold text-center px-2">
            {button.label}
          </span>
        </button>
      ))}

      {error && (
        <div
          role="alert"
          className="absolute bottom-4 left-4 right-4 bg-red-800 text-white p-3 rounded-lg text-center font-semibold"
        >
          {error}
        </div>
      )}
    </div>
  );
}
