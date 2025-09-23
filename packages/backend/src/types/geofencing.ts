/**
 * Geofencing types for Smart Tourist Safety Monitoring System
 *
 * This module defines all TypeScript interfaces and types used for geofencing operations,
 * including zone definitions, location tracking, and webhook notifications.
 */

import { Point, Polygon } from 'geojson';

// Zone Types
export enum ZoneType {
  SAFE = 'safe',
  CAUTION = 'caution',
  RESTRICTED = 'restricted',
  HIGH_RISK = 'high_risk',
  EMERGENCY = 'emergency',
  TOURIST_FRIENDLY = 'tourist_friendly'
}

export enum ZoneStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  MAINTENANCE = 'maintenance'
}

// Coordinate and Geometry Types
export interface Coordinate {
  latitude: number;
  longitude: number;
}

export interface BoundingBox {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

// Zone Definition
export interface Zone {
  id: string;
  name: string;
  type: ZoneType;
  status: ZoneStatus;
  description?: string;
  geometry: Polygon;
  coordinates: Coordinate[]; // 4-coordinate polygon
  boundingBox: BoundingBox;
  metadata?: {
    riskLevel: number; // 1-10 scale
    alertMessage?: string;
    emergencyContacts?: string[];
    createdBy: string;
    createdAt: string;
    updatedAt: string;
  };
}

// Location Types
export interface LocationPoint {
  userId: string;
  coordinates: Coordinate;
  accuracy?: number; // GPS accuracy in meters
  timestamp: string;
  battery?: number; // Battery level 0-100
  speed?: number; // Speed in m/s
  bearing?: number; // Direction in degrees
}

export interface LocationUpdate extends LocationPoint {
  deviceId?: string;
  appVersion?: string;
  networkType?: 'wifi' | '4g' | '5g' | 'offline';
}

// Geofence Event Types
export enum GeofenceEventType {
  ENTER = 'enter',
  EXIT = 'exit',
  INSIDE = 'inside',
  OUTSIDE = 'outside'
}

export interface GeofenceEvent {
  id: string;
  userId: string;
  zoneId: string;
  zoneName?: string;
  zoneType?: ZoneType;
  eventType: GeofenceEventType;
  coordinates: Coordinate;
  timestamp: string;
  processed?: boolean;
  webhookDelivered?: boolean;
  metadata?: {
    previousZoneId?: string;
    timeInZone?: number; // seconds
    alertLevel?: 'low' | 'medium' | 'high' | 'critical';
    eventSource?: string;
    [key: string]: any;
  };
}

// Webhook Types
export interface WebhookPayload {
  event: GeofenceEvent;
  zone: Zone;
  user: {
    id: string;
    name?: string;
    emergencyContacts?: string[];
  };
  timestamp: string;
  signature?: string; // HMAC signature for webhook verification
}

export interface WebhookConfig {
  id: string;
  name: string;
  url: string;
  secret?: string;
  enabled: boolean;
  zoneIds?: string[]; // If specified, only trigger for these zones
  zoneTypes?: ZoneType[]; // If specified, only trigger for these zone types
  eventTypes: GeofenceEventType[];
  retryConfig: {
    maxRetries: number;
    retryDelay: number; // milliseconds
    exponentialBackoff: boolean;
  };
  headers?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

// Query Types
export interface NearbyQuery {
  center: Coordinate;
  radius: number; // meters
  limit?: number;
  cursor?: number;
}

export interface WithinQuery {
  bounds: BoundingBox | Coordinate[];
  limit?: number;
  cursor?: number;
}

export interface IntersectsQuery {
  geometry: Polygon | Point;
  limit?: number;
  cursor?: number;
}

// Response Types
export interface QueryResponse<T> {
  objects: T[];
  count: number;
  cursor: number;
  elapsed: string;
}

export interface NearbyResponse extends QueryResponse<LocationPoint & { distance: number }> {}

export interface WithinResponse extends QueryResponse<LocationPoint> {}

// Service Configuration
export interface Tile38Config {
  host: string;
  port: number;
  password?: string;
  database?: number;
  maxRetriesPerRequest: number;
  retryDelayOnClusterDown: number;
  retryDelayOnFailover: number;
  maxRetriesPerCluster: number;
  enableReadyCheck: boolean;
  lazyConnect: boolean;
  keepAlive: number;
}

export interface GeofencingServiceConfig {
  tile38: Tile38Config;
  collections: {
    tourists: string;
    zones: string;
    events: string;
  };
  performance: {
    maxConcurrentQueries: number;
    queryTimeout: number; // milliseconds
    batchSize: number;
    enableCaching: boolean;
    cacheTimeout: number; // seconds
  };
  webhooks: {
    enabled: boolean;
    timeout: number; // milliseconds
    maxConcurrent: number;
    queueEnabled: boolean;
    queueSize: number;
  };
}

// Error Types
export class GeofencingError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public details?: any
  ) {
    super(message);
    this.name = 'GeofencingError';
  }
}

export class ZoneValidationError extends GeofencingError {
  constructor(message: string, details?: any) {
    super(message, 'ZONE_VALIDATION_ERROR', 400, details);
    this.name = 'ZoneValidationError';
  }
}

export class LocationValidationError extends GeofencingError {
  constructor(message: string, details?: any) {
    super(message, 'LOCATION_VALIDATION_ERROR', 400, details);
    this.name = 'LocationValidationError';
  }
}

export class Tile38ConnectionError extends GeofencingError {
  constructor(message: string, details?: any) {
    super(message, 'TILE38_CONNECTION_ERROR', 503, details);
    this.name = 'Tile38ConnectionError';
  }
}

// Bulk Processing Types
export interface BulkLocationUpdate {
  batchId: string;
  locations: LocationPoint[];
  priority?: number;
  timestamp: string;
}

export interface ProcessingStats {
  totalProcessed: number;
  successCount: number;
  errorCount: number;
  averageProcessingTime: number;
  queueSize: number;
  throughputPerSecond: number;
}

// Health Check Types
export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy' | 'degraded';
  tile38: {
    connected: boolean;
    latency: number; // milliseconds
    memory: string;
    clients: number;
  };
  collections: {
    [key: string]: {
      count: number;
      lastUpdated: string;
    };
  };
  performance: {
    averageQueryTime: number; // milliseconds
    requestsPerSecond: number;
    errorRate: number; // percentage
  };
  timestamp: string;
}