// Constants for the Smart Tourist Safety system

export const APP_NAME = 'Smart Tourist Safety';
export const APP_VERSION = '1.0.0';

export const ALERT_TYPES = {
  EMERGENCY: 'emergency',
  GEOFENCE: 'geofence',
  SAFETY: 'safety',
  WEATHER: 'weather',
} as const;

export const ALERT_SEVERITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
} as const;

export const USER_ROLES = {
  TOURIST: 'tourist',
  ADMIN: 'admin',
  GUIDE: 'guide',
} as const;

export const DEFAULT_GEOFENCE_RADIUS = 1000; // meters
export const EMERGENCY_RESPONSE_TIME = 300; // seconds
export const LOCATION_UPDATE_INTERVAL = 30; // seconds