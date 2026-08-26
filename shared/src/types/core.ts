import type { EmergencyType, PriorityBand, SOSStatus } from './enums';

/**
 * Accessibility preferences for the survivor profile.
 */
export interface AccessibilityPreferences {
  largeText: boolean;
  highContrast: boolean;
  reducedMotion: boolean;
  screenReaderOptimized: boolean;
}

/**
 * Local SOS record stored in IndexedDB (Dexie) on the survivor device.
 * Contains all SOS data including delivery tracking fields.
 */
export interface LocalSOSRecord {
  id: string; // UUID
  emergencyType: EmergencyType;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  locationMethod: 'live' | 'lastKnown' | null;
  locationTimestamp: Date | null;
  timestamp: Date;
  peopleCount: number | null;
  situationType: string | null;
  description: string | null;
  priority: PriorityBand | null;
  status: SOSStatus;
  retryCount: number;
  lastTransmissionAttempt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * SOS record as sent to/received from the backend API.
 */
export interface SOSRecord {
  id: string;
  emergencyType: EmergencyType;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  locationMethod: 'live' | 'lastKnown' | null;
  locationTimestamp: Date | null;
  timestamp: Date;
  peopleCount: number | null;
  situationType: string | null;
  description: string | null;
  priorityScore: number;
  priorityBand: PriorityBand;
  status: SOSStatus;
  regionId: string | null;
  assignedResponderId: string | null;
  disasterEventId: string | null;
  duplicateFlag: boolean;
  duplicateOf: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Survivor profile stored locally on device.
 * All fields optional to allow partial configuration.
 */
export interface LocalProfile {
  name: string | null;
  language: 'en' | 'hi';
  emergencyContact: string | null;
  householdSize: number | null;
  accessibility: AccessibilityPreferences;
}

/**
 * Connectivity state of the device.
 */
export interface ConnectivityState {
  status: 'connected' | 'weak' | 'offline';
  lastChecked: Date;
}

/**
 * Result of an SOS send attempt.
 */
export interface SendResult {
  success: boolean;
  error?: string;
}

/**
 * Result of a location acquisition attempt.
 */
export interface LocationResult {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: Date;
  method: 'live' | 'lastKnown';
}
