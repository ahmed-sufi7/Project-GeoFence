/**
 * Zone Management Service
 *
 * This service handles polygon zone creation, validation, and management
 * for the Smart Tourist Safety Monitoring System.
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { Polygon } from 'geojson';
import {
  Zone,
  ZoneType,
  ZoneStatus,
  Coordinate,
  BoundingBox,
  ZoneValidationError,
  GeofencingError,
} from '../../types/geofencing';
import { GeospatialValidator } from './utils/GeospatialValidator';
import { ConnectionManager } from './ConnectionManager';

export interface ZoneCreationRequest {
  name: string;
  type: ZoneType;
  description?: string;
  coordinates: Coordinate[];
  riskLevel?: number;
  alertMessage?: string;
  emergencyContacts?: string[];
  createdBy: string;
}

export interface ZoneUpdateRequest {
  id: string;
  name?: string;
  type?: ZoneType;
  status?: ZoneStatus;
  description?: string;
  coordinates?: Coordinate[];
  riskLevel?: number;
  alertMessage?: string;
  emergencyContacts?: string[];
  updatedBy: string;
}

export interface ZoneSearchQuery {
  type?: ZoneType;
  status?: ZoneStatus;
  boundingBox?: BoundingBox;
  intersectsPoint?: Coordinate;
  intersectsPolygon?: Coordinate[];
  riskLevel?: { min?: number; max?: number };
  createdBy?: string;
  limit?: number;
  offset?: number;
}

export class ZoneManagementService extends EventEmitter {
  private connectionManager: ConnectionManager;
  private zoneCache: Map<string, Zone> = new Map();
  private readonly CACHE_TTL = 300000; // 5 minutes
  private cacheTimestamps: Map<string, number> = new Map();

  constructor(connectionManager: ConnectionManager) {
    super();
    this.connectionManager = connectionManager;
    this.setupCacheCleanup();
  }

  /**
   * Create a new zone
   */
  async createZone(request: ZoneCreationRequest): Promise<Zone> {
    try {
      // Validate request
      this.validateZoneCreationRequest(request);

      // Create zone object
      const zone: Zone = {
        id: uuidv4(),
        name: request.name,
        type: request.type,
        status: ZoneStatus.ACTIVE,
        description: request.description,
        coordinates: [...request.coordinates],
        boundingBox: GeospatialValidator.calculateBoundingBox(request.coordinates),
        geometry: this.coordinatesToGeoJSON(request.coordinates),
        metadata: {
          riskLevel: request.riskLevel || this.getDefaultRiskLevel(request.type),
          alertMessage: request.alertMessage,
          emergencyContacts: request.emergencyContacts || [],
          createdBy: request.createdBy,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      // Validate the complete zone
      GeospatialValidator.validateZonePolygon(zone);
      GeospatialValidator.validateFourCoordinatePolygon(zone.coordinates);

      // Check for overlaps with existing zones (if required)
      await this.checkZoneOverlaps(zone);

      // Store in Tile38
      await this.storeZoneInTile38(zone);

      // Cache the zone
      this.cacheZone(zone);

      // Emit event
      this.emit('zoneCreated', zone);

      console.log(`Zone created successfully: ${zone.id} (${zone.name})`);
      return zone;

    } catch (error) {
      console.error('Failed to create zone:', error);
      throw error instanceof GeofencingError ? error :
        new ZoneValidationError('Failed to create zone', { originalError: error });
    }
  }

  /**
   * Update an existing zone
   */
  async updateZone(request: ZoneUpdateRequest): Promise<Zone> {
    try {
      // Get existing zone
      const existingZone = await this.getZone(request.id);
      if (!existingZone) {
        throw new ZoneValidationError(`Zone not found: ${request.id}`);
      }

      // Create updated zone
      const updatedZone: Zone = {
        ...existingZone,
        name: request.name || existingZone.name,
        type: request.type || existingZone.type,
        status: request.status || existingZone.status,
        description: request.description !== undefined ? request.description : existingZone.description,
        coordinates: request.coordinates || existingZone.coordinates,
        boundingBox: request.coordinates ?
          GeospatialValidator.calculateBoundingBox(request.coordinates) :
          existingZone.boundingBox,
        geometry: request.coordinates ?
          this.coordinatesToGeoJSON(request.coordinates) :
          existingZone.geometry,
        metadata: {
          ...existingZone.metadata,
          riskLevel: request.riskLevel !== undefined ? request.riskLevel : existingZone.metadata?.riskLevel || 5,
          alertMessage: request.alertMessage !== undefined ? request.alertMessage : existingZone.metadata?.alertMessage,
          emergencyContacts: request.emergencyContacts || existingZone.metadata?.emergencyContacts || [],
          updatedAt: new Date().toISOString(),
        },
      };

      // Validate updated zone
      if (request.coordinates) {
        GeospatialValidator.validateZonePolygon(updatedZone);
        GeospatialValidator.validateFourCoordinatePolygon(updatedZone.coordinates);
        await this.checkZoneOverlaps(updatedZone, request.id); // Exclude self from overlap check
      }

      // Update in Tile38
      await this.storeZoneInTile38(updatedZone);

      // Update cache
      this.cacheZone(updatedZone);

      // Emit event
      this.emit('zoneUpdated', updatedZone, existingZone);

      console.log(`Zone updated successfully: ${updatedZone.id} (${updatedZone.name})`);
      return updatedZone;

    } catch (error) {
      console.error('Failed to update zone:', error);
      throw error instanceof GeofencingError ? error :
        new ZoneValidationError('Failed to update zone', { originalError: error });
    }
  }

  /**
   * Get a zone by ID
   */
  async getZone(zoneId: string): Promise<Zone | null> {
    try {
      // Check cache first
      const cached = this.getCachedZone(zoneId);
      if (cached) {
        return cached;
      }

      // Fetch from Tile38
      const zone = await this.connectionManager.executeRead(async (service) => {
        const result = await service.client.call('GET', 'zones', zoneId, 'WITHFIELDS');

        if (!result || result.length < 2 || !result[1]) {
          return null;
        }

        return this.parseZoneFromTile38(zoneId, result);
      });

      // Cache if found
      if (zone) {
        this.cacheZone(zone);
      }

      return zone;

    } catch (error) {
      console.error('Failed to get zone:', error);
      return null;
    }
  }

  /**
   * Delete a zone
   */
  async deleteZone(zoneId: string, deletedBy: string): Promise<boolean> {
    try {
      const zone = await this.getZone(zoneId);
      if (!zone) {
        throw new ZoneValidationError(`Zone not found: ${zoneId}`);
      }

      // Remove from Tile38
      await this.connectionManager.executeWrite(async (service) => {
        return service.client.call('DEL', 'zones', zoneId);
      });

      // Remove from cache
      this.removeCachedZone(zoneId);

      // Emit event
      this.emit('zoneDeleted', zone, deletedBy);

      console.log(`Zone deleted successfully: ${zoneId} (${zone.name})`);
      return true;

    } catch (error) {
      console.error('Failed to delete zone:', error);
      throw error instanceof GeofencingError ? error :
        new ZoneValidationError('Failed to delete zone', { originalError: error });
    }
  }

  /**
   * Search zones based on criteria
   */
  async searchZones(query: ZoneSearchQuery): Promise<Zone[]> {
    try {
      const zones: Zone[] = [];

      if (query.intersectsPoint) {
        // Find zones that contain a specific point
        const result = await this.connectionManager.executeRead(async (service) => {
          return service.client.call(
            'INTERSECTS',
            'zones',
            'LIMIT', query.limit || 100,
            'POINT',
            query.intersectsPoint!.latitude,
            query.intersectsPoint!.longitude
          );
        });

        zones.push(...await this.parseZonesFromTile38Results(result));

      } else if (query.boundingBox) {
        // Find zones within a bounding box
        const { minLat, minLon, maxLat, maxLon } = query.boundingBox;
        const result = await this.connectionManager.executeRead(async (service) => {
          return service.client.call(
            'INTERSECTS',
            'zones',
            'LIMIT', query.limit || 100,
            'BOUNDS',
            minLat, minLon, maxLat, maxLon
          );
        });

        zones.push(...await this.parseZonesFromTile38Results(result));

      } else {
        // Get all zones and filter
        const result = await this.connectionManager.executeRead(async (service) => {
          return service.client.call('SCAN', 'zones', 'LIMIT', query.limit || 100);
        });

        zones.push(...await this.parseZonesFromTile38Results(result));
      }

      // Apply additional filters
      return this.applyZoneFilters(zones, query);

    } catch (error) {
      console.error('Failed to search zones:', error);
      throw new ZoneValidationError('Failed to search zones', { originalError: error });
    }
  }

  /**
   * Get zones that contain a specific point
   */
  async getZonesContainingPoint(point: Coordinate): Promise<Zone[]> {
    return this.searchZones({ intersectsPoint: point });
  }

  /**
   * Get zones by type
   */
  async getZonesByType(type: ZoneType, limit?: number): Promise<Zone[]> {
    return this.searchZones({ type, limit });
  }

  /**
   * Get active zones
   */
  async getActiveZones(limit?: number): Promise<Zone[]> {
    return this.searchZones({ status: ZoneStatus.ACTIVE, limit });
  }

  /**
   * Check if a point is in any restricted zone
   */
  async isPointInRestrictedZone(point: Coordinate): Promise<{ inRestrictedZone: boolean; zones: Zone[] }> {
    const zones = await this.getZonesContainingPoint(point);
    const restrictedZones = zones.filter(zone =>
      zone.type === ZoneType.RESTRICTED || zone.type === ZoneType.HIGH_RISK
    );

    return {
      inRestrictedZone: restrictedZones.length > 0,
      zones: restrictedZones,
    };
  }

  /**
   * Get zone statistics
   */
  async getZoneStatistics(): Promise<{
    total: number;
    byType: Record<ZoneType, number>;
    byStatus: Record<ZoneStatus, number>;
    averageArea: number;
  }> {
    try {
      const allZones = await this.searchZones({ limit: 10000 });

      const stats = {
        total: allZones.length,
        byType: {} as Record<ZoneType, number>,
        byStatus: {} as Record<ZoneStatus, number>,
        averageArea: 0,
      };

      // Initialize counters
      Object.values(ZoneType).forEach(type => stats.byType[type] = 0);
      Object.values(ZoneStatus).forEach(status => stats.byStatus[status] = 0);

      let totalArea = 0;

      allZones.forEach(zone => {
        stats.byType[zone.type]++;
        stats.byStatus[zone.status]++;
        totalArea += GeospatialValidator.calculatePolygonArea(zone.coordinates);
      });

      stats.averageArea = allZones.length > 0 ? totalArea / allZones.length : 0;

      return stats;

    } catch (error) {
      console.error('Failed to get zone statistics:', error);
      throw new ZoneValidationError('Failed to get zone statistics', { originalError: error });
    }
  }

  /**
   * Validate zone creation request
   */
  private validateZoneCreationRequest(request: ZoneCreationRequest): void {
    if (!request.name || typeof request.name !== 'string') {
      throw new ZoneValidationError('Zone name is required');
    }

    GeospatialValidator.validateZoneName(request.name);

    if (!Object.values(ZoneType).includes(request.type)) {
      throw new ZoneValidationError('Invalid zone type');
    }

    if (!request.coordinates || !Array.isArray(request.coordinates)) {
      throw new ZoneValidationError('Zone coordinates are required');
    }

    if (!request.createdBy) {
      throw new ZoneValidationError('Created by field is required');
    }

    if (request.riskLevel !== undefined && (request.riskLevel < 1 || request.riskLevel > 10)) {
      throw new ZoneValidationError('Risk level must be between 1 and 10');
    }
  }

  /**
   * Store zone in Tile38
   */
  private async storeZoneInTile38(zone: Zone): Promise<void> {
    await this.connectionManager.executeWrite(async (service) => {
      // Convert coordinates to flat array for Tile38
      const polygonCoords = zone.coordinates
        .map(coord => [coord.longitude, coord.latitude])
        .flat();

      return service.client.call(
        'SET',
        'zones',
        zone.id,
        'FIELD', 'name', zone.name,
        'FIELD', 'type', zone.type,
        'FIELD', 'status', zone.status,
        'FIELD', 'description', zone.description || '',
        'FIELD', 'riskLevel', zone.metadata?.riskLevel || 5,
        'FIELD', 'createdBy', zone.metadata?.createdBy || '',
        'FIELD', 'createdAt', zone.metadata?.createdAt || '',
        'FIELD', 'updatedAt', zone.metadata?.updatedAt || '',
        'POLYGON',
        polygonCoords
      );
    });
  }

  /**
   * Parse zone from Tile38 result
   */
  private parseZoneFromTile38(zoneId: string, result: any): Zone | null {
    try {
      const fields = this.parseFields(result);
      const geometry = JSON.parse(result[1]);

      const coordinates: Coordinate[] = geometry.coordinates[0].map((coord: [number, number]) => ({
        longitude: coord[0],
        latitude: coord[1],
      }));

      return {
        id: zoneId,
        name: fields.name || '',
        type: (fields.type as ZoneType) || ZoneType.SAFE,
        status: (fields.status as ZoneStatus) || ZoneStatus.ACTIVE,
        description: fields.description,
        coordinates,
        boundingBox: GeospatialValidator.calculateBoundingBox(coordinates),
        geometry: geometry as Polygon,
        metadata: {
          riskLevel: parseInt(fields.riskLevel) || 5,
          createdBy: fields.createdBy || '',
          createdAt: fields.createdAt || '',
          updatedAt: fields.updatedAt || '',
        },
      };
    } catch (error) {
      console.error('Failed to parse zone from Tile38:', error);
      return null;
    }
  }

  /**
   * Parse zones from Tile38 search results
   */
  private async parseZonesFromTile38Results(result: any): Promise<Zone[]> {
    if (!result || !Array.isArray(result) || result.length < 2) {
      return [];
    }

    const zones: Zone[] = [];
    const objects = result[1];

    if (Array.isArray(objects)) {
      for (let i = 0; i < objects.length; i += 2) {
        const zoneId = objects[i];
        const zoneData = objects[i + 1];

        if (zoneId && zoneData) {
          const zone = this.parseZoneFromTile38(zoneId, [null, zoneData]);
          if (zone) {
            zones.push(zone);
          }
        }
      }
    }

    return zones;
  }

  /**
   * Parse fields from Tile38 result
   */
  private parseFields(result: any): Record<string, any> {
    const fields: Record<string, any> = {};

    if (result.length > 2 && Array.isArray(result[2])) {
      const fieldArray = result[2];
      for (let i = 0; i < fieldArray.length; i += 2) {
        const key = fieldArray[i];
        const value = fieldArray[i + 1];
        if (key && value !== undefined) {
          fields[key] = value;
        }
      }
    }

    return fields;
  }

  /**
   * Apply filters to zone search results
   */
  private applyZoneFilters(zones: Zone[], query: ZoneSearchQuery): Zone[] {
    let filtered = zones;

    if (query.type) {
      filtered = filtered.filter(zone => zone.type === query.type);
    }

    if (query.status) {
      filtered = filtered.filter(zone => zone.status === query.status);
    }

    if (query.riskLevel) {
      filtered = filtered.filter(zone => {
        const riskLevel = zone.metadata?.riskLevel || 5;
        if (query.riskLevel!.min !== undefined && riskLevel < query.riskLevel!.min) return false;
        if (query.riskLevel!.max !== undefined && riskLevel > query.riskLevel!.max) return false;
        return true;
      });
    }

    if (query.createdBy) {
      filtered = filtered.filter(zone => zone.metadata?.createdBy === query.createdBy);
    }

    // Apply pagination
    if (query.offset) {
      filtered = filtered.slice(query.offset);
    }

    if (query.limit) {
      filtered = filtered.slice(0, query.limit);
    }

    return filtered;
  }

  /**
   * Check for zone overlaps
   */
  private async checkZoneOverlaps(zone: Zone, excludeZoneId?: string): Promise<void> {
    const overlappingZones = await this.searchZones({
      boundingBox: zone.boundingBox,
      status: ZoneStatus.ACTIVE,
    });

    for (const existingZone of overlappingZones) {
      if (excludeZoneId && existingZone.id === excludeZoneId) {
        continue;
      }

      if (GeospatialValidator.polygonsOverlap(zone.coordinates, existingZone.coordinates)) {
        throw new ZoneValidationError(
          `Zone overlaps with existing zone: ${existingZone.name} (${existingZone.id})`
        );
      }
    }
  }

  /**
   * Convert coordinates to GeoJSON Polygon
   */
  private coordinatesToGeoJSON(coordinates: Coordinate[]): Polygon {
    const coords = coordinates.map(coord => [coord.longitude, coord.latitude]);

    // Ensure polygon is closed
    if (coords.length > 0 &&
        (coords[0][0] !== coords[coords.length - 1][0] ||
         coords[0][1] !== coords[coords.length - 1][1])) {
      coords.push([...coords[0]]);
    }

    return {
      type: 'Polygon',
      coordinates: [coords],
    };
  }

  /**
   * Get default risk level for zone type
   */
  private getDefaultRiskLevel(type: ZoneType): number {
    switch (type) {
      case ZoneType.SAFE: return 2;
      case ZoneType.TOURIST_FRIENDLY: return 3;
      case ZoneType.CAUTION: return 5;
      case ZoneType.RESTRICTED: return 7;
      case ZoneType.HIGH_RISK: return 9;
      case ZoneType.EMERGENCY: return 10;
      default: return 5;
    }
  }

  /**
   * Cache management methods
   */
  private cacheZone(zone: Zone): void {
    this.zoneCache.set(zone.id, zone);
    this.cacheTimestamps.set(zone.id, Date.now());
  }

  private getCachedZone(zoneId: string): Zone | null {
    const timestamp = this.cacheTimestamps.get(zoneId);
    if (!timestamp || Date.now() - timestamp > this.CACHE_TTL) {
      this.removeCachedZone(zoneId);
      return null;
    }

    return this.zoneCache.get(zoneId) || null;
  }

  private removeCachedZone(zoneId: string): void {
    this.zoneCache.delete(zoneId);
    this.cacheTimestamps.delete(zoneId);
  }

  private setupCacheCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      for (const [zoneId, timestamp] of this.cacheTimestamps.entries()) {
        if (now - timestamp > this.CACHE_TTL) {
          this.removeCachedZone(zoneId);
        }
      }
    }, 60000); // Clean up every minute
  }

  /**
   * Get service health status
   */
  async getHealthStatus(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    cachedZones: number;
    lastError?: string;
  }> {
    try {
      // Try to perform a simple operation
      await this.connectionManager.executeRead(async (service) => {
        return service.client.call('PING');
      });

      return {
        status: 'healthy',
        cachedZones: this.zoneCache.size,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        cachedZones: this.zoneCache.size,
        lastError: error.message,
      };
    }
  }
}