/**
 * Supabase Integration Service for Geofencing System
 *
 * This service provides integration between Tile38 geofencing operations and Supabase database
 * for zone definitions, user location history, incident correlation, and data synchronization.
 */

import { EventEmitter } from 'events';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  Zone,
  LocationPoint,
  GeofenceEvent,
  ZoneType,
  ZoneStatus,
  Coordinate
} from '../../types/geofencing';

interface SupabaseZone {
  id: string;
  name: string;
  type: ZoneType;
  status: ZoneStatus;
  description?: string;
  coordinates: Coordinate[];
  risk_level: number;
  alert_message?: string;
  emergency_contacts?: string[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface SupabaseLocationHistory {
  id: string;
  user_id: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  bearing?: number;
  battery?: number;
  timestamp: string;
  created_at: string;
}

interface SupabaseGeofenceEvent {
  id: string;
  user_id: string;
  zone_id: string;
  event_type: 'enter' | 'exit' | 'inside' | 'outside';
  latitude: number;
  longitude: number;
  processed: boolean;
  webhook_delivered?: boolean;
  alert_level?: 'low' | 'medium' | 'high' | 'critical';
  timestamp: string;
  created_at: string;
  metadata?: Record<string, any>;
}

interface SupabaseConfig {
  url: string;
  anonKey: string;
  serviceRoleKey?: string;
}

interface SyncStats {
  zonesSync: {
    created: number;
    updated: number;
    deleted: number;
    errors: number;
  };
  locationsSync: {
    created: number;
    errors: number;
  };
  eventsSync: {
    created: number;
    updated: number;
    errors: number;
  };
  lastSyncTime: string;
}

export class SupabaseIntegrationService extends EventEmitter {
  private supabase: SupabaseClient;
  private config: SupabaseConfig;
  private syncStats: SyncStats = {
    zonesSync: { created: 0, updated: 0, deleted: 0, errors: 0 },
    locationsSync: { created: 0, errors: 0 },
    eventsSync: { created: 0, updated: 0, errors: 0 },
    lastSyncTime: new Date().toISOString()
  };

  constructor(config: SupabaseConfig) {
    super();
    this.config = config;
    this.supabase = createClient(config.url, config.anonKey);
  }

  /**
   * Initialize the service and setup database tables if needed
   */
  async initialize(): Promise<void> {
    try {
      await this.ensureTablesExist();
      this.emit('initialized');
      console.log('SupabaseIntegrationService initialized successfully');
    } catch (error) {
      console.error('Failed to initialize SupabaseIntegrationService:', error);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Ensure required database tables exist
   */
  private async ensureTablesExist(): Promise<void> {
    // This would typically be handled by migrations, but we can check table existence
    const tables = ['geofence_zones', 'location_history', 'geofence_events'];

    for (const table of tables) {
      try {
        const { data, error } = await this.supabase
          .from(table)
          .select('*')
          .limit(1);

        if (error && error.message.includes('does not exist')) {
          console.warn(`Table ${table} does not exist. Please create it using Supabase migrations.`);
        }
      } catch (error) {
        console.warn(`Could not verify table ${table}:`, error);
      }
    }
  }

  /**
   * Sync zones from Supabase to Tile38
   */
  async syncZonesFromSupabase(): Promise<Zone[]> {
    try {
      const { data: supabaseZones, error } = await this.supabase
        .from('geofence_zones')
        .select('*')
        .eq('status', 'active');

      if (error) {
        this.syncStats.zonesSync.errors++;
        throw error;
      }

      const zones: Zone[] = [];

      for (const supabaseZone of supabaseZones || []) {
        try {
          const zone = this.convertSupabaseZoneToZone(supabaseZone);
          zones.push(zone);
          this.syncStats.zonesSync.created++;
        } catch (error) {
          console.error(`Error converting zone ${supabaseZone.id}:`, error);
          this.syncStats.zonesSync.errors++;
        }
      }

      this.syncStats.lastSyncTime = new Date().toISOString();
      this.emit('zonesSync', { zones, stats: this.syncStats.zonesSync });

      return zones;
    } catch (error) {
      console.error('Failed to sync zones from Supabase:', error);
      this.emit('syncError', { operation: 'syncZonesFromSupabase', error });
      throw error;
    }
  }

  /**
   * Create or update a zone in Supabase
   */
  async upsertZoneToSupabase(zone: Zone): Promise<void> {
    try {
      const supabaseZone = this.convertZoneToSupabaseZone(zone);

      const { error } = await this.supabase
        .from('geofence_zones')
        .upsert(supabaseZone, {
          onConflict: 'id'
        });

      if (error) {
        this.syncStats.zonesSync.errors++;
        throw error;
      }

      this.syncStats.zonesSync.updated++;
      this.emit('zoneUpserted', { zoneId: zone.id });
    } catch (error) {
      console.error(`Failed to upsert zone ${zone.id} to Supabase:`, error);
      this.emit('syncError', { operation: 'upsertZoneToSupabase', zoneId: zone.id, error });
      throw error;
    }
  }

  /**
   * Delete a zone from Supabase
   */
  async deleteZoneFromSupabase(zoneId: string): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('geofence_zones')
        .delete()
        .eq('id', zoneId);

      if (error) {
        this.syncStats.zonesSync.errors++;
        throw error;
      }

      this.syncStats.zonesSync.deleted++;
      this.emit('zoneDeleted', { zoneId });
    } catch (error) {
      console.error(`Failed to delete zone ${zoneId} from Supabase:`, error);
      this.emit('syncError', { operation: 'deleteZoneFromSupabase', zoneId, error });
      throw error;
    }
  }

  /**
   * Store location history in Supabase
   */
  async storeLocationHistory(location: LocationPoint): Promise<void> {
    try {
      const locationHistory: Partial<SupabaseLocationHistory> = {
        user_id: location.userId,
        latitude: location.coordinates.latitude,
        longitude: location.coordinates.longitude,
        accuracy: location.accuracy,
        speed: location.speed,
        bearing: location.bearing,
        battery: location.battery,
        timestamp: location.timestamp,
        created_at: new Date().toISOString()
      };

      const { error } = await this.supabase
        .from('location_history')
        .insert(locationHistory);

      if (error) {
        this.syncStats.locationsSync.errors++;
        throw error;
      }

      this.syncStats.locationsSync.created++;
      this.emit('locationStored', { userId: location.userId });
    } catch (error) {
      console.error(`Failed to store location history for user ${location.userId}:`, error);
      this.emit('syncError', { operation: 'storeLocationHistory', userId: location.userId, error });
      throw error;
    }
  }

  /**
   * Get user location history from Supabase
   */
  async getUserLocationHistory(
    userId: string,
    startTime?: string,
    endTime?: string,
    limit: number = 100
  ): Promise<LocationPoint[]> {
    try {
      let query = this.supabase
        .from('location_history')
        .select('*')
        .eq('user_id', userId)
        .order('timestamp', { ascending: false })
        .limit(limit);

      if (startTime) {
        query = query.gte('timestamp', startTime);
      }

      if (endTime) {
        query = query.lte('timestamp', endTime);
      }

      const { data, error } = await query;

      if (error) {
        throw error;
      }

      return (data || []).map(record => ({
        userId: record.user_id,
        coordinates: {
          latitude: record.latitude,
          longitude: record.longitude
        },
        accuracy: record.accuracy,
        speed: record.speed,
        bearing: record.bearing,
        battery: record.battery,
        timestamp: record.timestamp
      }));
    } catch (error) {
      console.error(`Failed to get location history for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Store geofence event in Supabase
   */
  async storeGeofenceEvent(event: GeofenceEvent): Promise<void> {
    try {
      const supabaseEvent: Partial<SupabaseGeofenceEvent> = {
        id: event.id,
        user_id: event.userId,
        zone_id: event.zoneId,
        event_type: event.eventType,
        latitude: event.coordinates.latitude,
        longitude: event.coordinates.longitude,
        processed: event.processed || false,
        webhook_delivered: event.webhookDelivered,
        alert_level: event.metadata?.alertLevel,
        timestamp: event.timestamp,
        created_at: new Date().toISOString(),
        metadata: event.metadata
      };

      const { error } = await this.supabase
        .from('geofence_events')
        .insert(supabaseEvent);

      if (error) {
        this.syncStats.eventsSync.errors++;
        throw error;
      }

      this.syncStats.eventsSync.created++;
      this.emit('eventStored', { eventId: event.id, userId: event.userId, zoneId: event.zoneId });
    } catch (error) {
      console.error(`Failed to store geofence event ${event.id}:`, error);
      this.emit('syncError', { operation: 'storeGeofenceEvent', eventId: event.id, error });
      throw error;
    }
  }

  /**
   * Update geofence event processing status
   */
  async updateEventProcessingStatus(eventId: string, processed: boolean, webhookDelivered?: boolean): Promise<void> {
    try {
      const updateData: Partial<SupabaseGeofenceEvent> = {
        processed,
        updated_at: new Date().toISOString()
      };

      if (webhookDelivered !== undefined) {
        updateData.webhook_delivered = webhookDelivered;
      }

      const { error } = await this.supabase
        .from('geofence_events')
        .update(updateData)
        .eq('id', eventId);

      if (error) {
        this.syncStats.eventsSync.errors++;
        throw error;
      }

      this.syncStats.eventsSync.updated++;
      this.emit('eventUpdated', { eventId, processed, webhookDelivered });
    } catch (error) {
      console.error(`Failed to update event processing status for ${eventId}:`, error);
      this.emit('syncError', { operation: 'updateEventProcessingStatus', eventId, error });
      throw error;
    }
  }

  /**
   * Get unprocessed geofence events
   */
  async getUnprocessedEvents(limit: number = 100): Promise<GeofenceEvent[]> {
    try {
      const { data, error } = await this.supabase
        .from('geofence_events')
        .select('*')
        .eq('processed', false)
        .order('created_at', { ascending: true })
        .limit(limit);

      if (error) {
        throw error;
      }

      return (data || []).map(record => this.convertSupabaseEventToGeofenceEvent(record));
    } catch (error) {
      console.error('Failed to get unprocessed events:', error);
      throw error;
    }
  }

  /**
   * Calculate distance between two points using Supabase PostGIS
   */
  async calculateDistance(
    point1: Coordinate,
    point2: Coordinate,
    unit: 'meters' | 'kilometers' | 'miles' = 'meters'
  ): Promise<number> {
    try {
      // Use PostGIS ST_Distance function
      const { data, error } = await this.supabase.rpc('calculate_distance', {
        lat1: point1.latitude,
        lon1: point1.longitude,
        lat2: point2.latitude,
        lon2: point2.longitude,
        unit_type: unit
      });

      if (error) {
        throw error;
      }

      return data || 0;
    } catch (error) {
      console.error('Failed to calculate distance using PostGIS:', error);

      // Fallback to Haversine formula
      return this.calculateHaversineDistance(point1, point2, unit);
    }
  }

  /**
   * Fallback Haversine distance calculation
   */
  private calculateHaversineDistance(
    point1: Coordinate,
    point2: Coordinate,
    unit: 'meters' | 'kilometers' | 'miles' = 'meters'
  ): number {
    const R = 6371; // Earth's radius in kilometers

    const dLat = this.toRadians(point2.latitude - point1.latitude);
    const dLon = this.toRadians(point2.longitude - point1.longitude);

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRadians(point1.latitude)) * Math.cos(this.toRadians(point2.latitude)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    let distance = R * c; // Distance in kilometers

    // Convert to requested unit
    switch (unit) {
      case 'meters':
        distance *= 1000;
        break;
      case 'miles':
        distance *= 0.621371;
        break;
      // 'kilometers' is already the default
    }

    return distance;
  }

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Get synchronization statistics
   */
  getSyncStats(): SyncStats {
    return { ...this.syncStats };
  }

  /**
   * Reset synchronization statistics
   */
  resetSyncStats(): void {
    this.syncStats = {
      zonesSync: { created: 0, updated: 0, deleted: 0, errors: 0 },
      locationsSync: { created: 0, errors: 0 },
      eventsSync: { created: 0, updated: 0, errors: 0 },
      lastSyncTime: new Date().toISOString()
    };
  }

  /**
   * Conversion helpers
   */
  private convertSupabaseZoneToZone(supabaseZone: any): Zone {
    return {
      id: supabaseZone.id,
      name: supabaseZone.name,
      type: supabaseZone.type,
      status: supabaseZone.status,
      description: supabaseZone.description,
      geometry: {
        type: 'Polygon',
        coordinates: [supabaseZone.coordinates.map((coord: Coordinate) => [coord.longitude, coord.latitude])]
      },
      coordinates: supabaseZone.coordinates,
      boundingBox: this.calculateBoundingBox(supabaseZone.coordinates),
      metadata: {
        riskLevel: supabaseZone.risk_level,
        alertMessage: supabaseZone.alert_message,
        emergencyContacts: supabaseZone.emergency_contacts,
        createdBy: supabaseZone.created_by,
        createdAt: supabaseZone.created_at,
        updatedAt: supabaseZone.updated_at
      }
    };
  }

  private convertZoneToSupabaseZone(zone: Zone): Partial<SupabaseZone> {
    return {
      id: zone.id,
      name: zone.name,
      type: zone.type,
      status: zone.status,
      description: zone.description,
      coordinates: zone.coordinates,
      risk_level: zone.metadata?.riskLevel || 1,
      alert_message: zone.metadata?.alertMessage,
      emergency_contacts: zone.metadata?.emergencyContacts,
      created_by: zone.metadata?.createdBy || 'system',
      created_at: zone.metadata?.createdAt || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  }

  private convertSupabaseEventToGeofenceEvent(supabaseEvent: any): GeofenceEvent {
    return {
      id: supabaseEvent.id,
      userId: supabaseEvent.user_id,
      zoneId: supabaseEvent.zone_id,
      eventType: supabaseEvent.event_type,
      coordinates: {
        latitude: supabaseEvent.latitude,
        longitude: supabaseEvent.longitude
      },
      timestamp: supabaseEvent.timestamp,
      processed: supabaseEvent.processed,
      webhookDelivered: supabaseEvent.webhook_delivered,
      metadata: {
        alertLevel: supabaseEvent.alert_level,
        ...supabaseEvent.metadata
      }
    };
  }

  private calculateBoundingBox(coordinates: Coordinate[]): { minLat: number; minLon: number; maxLat: number; maxLon: number } {
    const lats = coordinates.map(c => c.latitude);
    const lons = coordinates.map(c => c.longitude);

    return {
      minLat: Math.min(...lats),
      minLon: Math.min(...lons),
      maxLat: Math.max(...lats),
      maxLon: Math.max(...lons)
    };
  }

  /**
   * Shutdown the service
   */
  async shutdown(): Promise<void> {
    this.removeAllListeners();
    console.log('SupabaseIntegrationService shutdown complete');
  }
}