// Common types for the Smart Tourist Safety system
export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'tourist' | 'admin' | 'guide';
  createdAt: Date;
  updatedAt: Date;
}

export interface Location {
  latitude: number;
  longitude: number;
  altitude?: number;
  accuracy?: number;
  timestamp: Date;
}

export interface SafeZone {
  id: string;
  name: string;
  coordinates: Location[];
  radius?: number;
  isActive: boolean;
  createdBy: string;
  createdAt: Date;
}

export interface Alert {
  id: string;
  userId: string;
  type: 'emergency' | 'geofence' | 'safety' | 'weather';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  location: Location;
  timestamp: Date;
  acknowledged: boolean;
}

export interface TouristGroup {
  id: string;
  name: string;
  guideId: string;
  members: string[];
  currentLocation?: Location;
  safeZones: string[];
  isActive: boolean;
}

export type ApiResponse<T = any> = {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
};