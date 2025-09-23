/**
 * Real-time Location Indexing Service
 *
 * High-performance location indexing system for tracking 10,000+ concurrent users
 * with sub-second query response times and efficient batch processing.
 */

import { EventEmitter } from 'events';
import {
  LocationPoint,
  LocationUpdate,
  NearbyQuery,
  WithinQuery,
  NearbyResponse,
  WithinResponse,
  GeofencingError,
  LocationValidationError,
  Coordinate,
} from '../../types/geofencing';
import { ConnectionManager } from './ConnectionManager';
import { GeospatialValidator } from './utils/GeospatialValidator';

export interface LocationIndexingConfig {
  batchSize: number;
  flushInterval: number; // milliseconds
  ttl: number; // Time-to-live for location data in seconds
  enableHistory: boolean;
  maxHistoryItems: number;
  compressionEnabled: boolean;
  indexOptimization: boolean;
}

export interface LocationQueryOptions {
  includeMetadata?: boolean;
  includeDistance?: boolean;
  sortByDistance?: boolean;
  filterByAccuracy?: number; // minimum accuracy in meters
  filterByTimestamp?: { since?: Date; until?: Date };
}

export interface LocationStatistics {
  totalLocations: number;
  activeUsers: number;
  locationsPerSecond: number;
  averageAccuracy: number;
  lastUpdate: Date;
  indexSize: string;
}

export class LocationIndexingService extends EventEmitter {
  private connectionManager: ConnectionManager;
  private config: LocationIndexingConfig;
  private locationBatch: LocationUpdate[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private stats = {
    locationsProcessed: 0,
    batchesProcessed: 0,
    lastFlushTime: Date.now(),
    errors: 0,
  };

  constructor(
    connectionManager: ConnectionManager,
    config?: Partial<LocationIndexingConfig>
  ) {
    super();
    this.connectionManager = connectionManager;
    this.config = {
      batchSize: 1000,
      flushInterval: 1000, // 1 second
      ttl: 3600, // 1 hour
      enableHistory: true,
      maxHistoryItems: 100,
      compressionEnabled: true,
      indexOptimization: true,
      ...config,
    };

    this.startBatchProcessor();
    this.setupPerformanceMonitoring();
  }

  /**
   * Update a user's location (real-time)
   */
  async updateLocation(location: LocationUpdate): Promise<void> {
    try {
      // Validate location
      GeospatialValidator.validateCoordinate(location.coordinates);
      this.validateLocationUpdate(location);

      // Add to batch for processing
      this.locationBatch.push({
        ...location,
        timestamp: location.timestamp || new Date().toISOString(),
      });

      // Check if batch is full
      if (this.locationBatch.length >= this.config.batchSize) {
        await this.flushBatch();
      }

      this.emit('locationUpdated', location);

    } catch (error) {
      this.stats.errors++;
      console.error('Failed to update location:', error);
      throw error instanceof GeofencingError ? error :
        new LocationValidationError('Failed to update location', { originalError: error });
    }
  }

  /**
   * Update multiple locations in batch
   */
  async updateLocationsBatch(locations: LocationUpdate[]): Promise<void> {
    try {
      // Validate all locations first
      for (const location of locations) {
        GeospatialValidator.validateCoordinate(location.coordinates);
        this.validateLocationUpdate(location);
      }

      // Add timestamps
      const timestampedLocations = locations.map(location => ({
        ...location,
        timestamp: location.timestamp || new Date().toISOString(),
      }));

      // Process in chunks
      const chunkSize = this.config.batchSize;
      for (let i = 0; i < timestampedLocations.length; i += chunkSize) {
        const chunk = timestampedLocations.slice(i, i + chunkSize);
        await this.processBatchChunk(chunk);
      }

      this.emit('batchLocationsUpdated', locations);

    } catch (error) {
      this.stats.errors++;
      console.error('Failed to update locations batch:', error);
      throw error instanceof GeofencingError ? error :
        new LocationValidationError('Failed to update locations batch', { originalError: error });
    }
  }

  /**
   * Get user's current location
   */
  async getCurrentLocation(userId: string): Promise<LocationPoint | null> {
    try {
      return await this.connectionManager.executeRead(async (service) => {
        const result = await service.client.call(
          'GET',
          'tourists',
          userId,
          'WITHFIELDS'
        );

        if (!result || result.length < 2 || !result[1]) {
          return null;
        }

        return this.parseLocationFromTile38(userId, result);
      });

    } catch (error) {
      console.error('Failed to get current location:', error);
      return null;
    }
  }

  /**
   * Get user's location history
   */
  async getLocationHistory(
    userId: string,
    limit: number = 50,
    since?: Date
  ): Promise<LocationPoint[]> {
    try {
      if (!this.config.enableHistory) {
        throw new GeofencingError('Location history is disabled');
      }

      return await this.connectionManager.executeRead(async (service) => {
        // Query location history collection
        const result = await service.client.call(
          'SCAN',
          `history:${userId}`,
          'LIMIT',
          limit,
          'DESC'
        );

        return this.parseLocationHistoryFromTile38(result, since);
      });

    } catch (error) {
      console.error('Failed to get location history:', error);
      throw new GeofencingError('Failed to get location history', { originalError: error });
    }
  }

  /**
   * Find users near a specific point
   */
  async findNearby(
    query: NearbyQuery,
    options?: LocationQueryOptions
  ): Promise<NearbyResponse> {
    try {
      return await this.connectionManager.executeRead(async (service) => {
        const args = [
          'NEARBY',
          'tourists',
          'LIMIT',
          query.limit || 100,
          'POINT',
          query.center.latitude,
          query.center.longitude,
          query.radius
        ];

        if (options?.includeDistance) {
          args.push('DISTANCE');
        }

        if (options?.includeMetadata) {
          args.push('WITHFIELDS');
        }

        const result = await service.client.call(...args);
        return this.formatNearbyResponse(result, options);
      });

    } catch (error) {
      console.error('Failed to find nearby users:', error);
      throw new GeofencingError('Failed to find nearby users', { originalError: error });
    }
  }

  /**
   * Find users within a specific area
   */
  async findWithin(
    query: WithinQuery,
    options?: LocationQueryOptions
  ): Promise<WithinResponse> {
    try {
      return await this.connectionManager.executeRead(async (service) => {
        let args: any[];

        if ('minLat' in query.bounds) {
          // Bounding box query
          const { minLat, minLon, maxLat, maxLon } = query.bounds;
          args = [
            'WITHIN',
            'tourists',
            'LIMIT',
            query.limit || 100,
            'BOUNDS',
            minLat, minLon, maxLat, maxLon
          ];
        } else {
          // Polygon query
          const coords = query.bounds as Coordinate[];
          const flatCoords = coords.map(c => [c.longitude, c.latitude]).flat();
          args = [
            'WITHIN',
            'tourists',
            'LIMIT',
            query.limit || 100,
            'POLYGON',
            ...flatCoords
          ];
        }

        if (options?.includeMetadata) {
          args.push('WITHFIELDS');
        }

        const result = await service.client.call(...args);
        return this.formatWithinResponse(result, options);
      });

    } catch (error) {
      console.error('Failed to find users within area:', error);
      throw new GeofencingError('Failed to find users within area', { originalError: error });
    }
  }

  /**
   * Get all active users
   */
  async getActiveUsers(limit: number = 1000): Promise<LocationPoint[]> {
    try {
      return await this.connectionManager.executeRead(async (service) => {
        const result = await service.client.call(
          'SCAN',
          'tourists',
          'LIMIT',
          limit,
          'WITHFIELDS'
        );

        return this.parseLocationsFromScanResult(result);
      });

    } catch (error) {
      console.error('Failed to get active users:', error);
      throw new GeofencingError('Failed to get active users', { originalError: error });
    }
  }

  /**
   * Remove user location (when user goes offline)
   */
  async removeUserLocation(userId: string): Promise<void> {
    try {
      await this.connectionManager.executeWrite(async (service) => {
        return service.client.call('DEL', 'tourists', userId);
      });

      this.emit('userLocationRemoved', userId);

    } catch (error) {
      console.error('Failed to remove user location:', error);
      throw new GeofencingError('Failed to remove user location', { originalError: error });
    }
  }

  /**
   * Get location indexing statistics
   */
  async getLocationStatistics(): Promise<LocationStatistics> {
    try {
      const result = await this.connectionManager.executeRead(async (service) => {
        return service.client.call('STATS', 'tourists');
      });

      const now = Date.now();
      const timeDiff = (now - this.stats.lastFlushTime) / 1000;
      const locationsPerSecond = timeDiff > 0 ? this.stats.locationsProcessed / timeDiff : 0;

      return {
        totalLocations: result?.in_memory_size || 0,
        activeUsers: result?.num_objects || 0,
        locationsPerSecond: Math.round(locationsPerSecond * 100) / 100,
        averageAccuracy: await this.calculateAverageAccuracy(),
        lastUpdate: new Date(),
        indexSize: this.formatBytes(result?.memory_usage || 0),
      };

    } catch (error) {
      console.error('Failed to get location statistics:', error);
      throw new GeofencingError('Failed to get location statistics', { originalError: error });
    }
  }

  /**
   * Optimize location indexes for performance
   */
  async optimizeIndexes(): Promise<void> {
    try {
      if (!this.config.indexOptimization) {
        return;
      }

      await this.connectionManager.executeWrite(async (service) => {
        // Force AOF rewrite to optimize storage
        return service.client.call('BGREWRITEAOF');
      });

      // Clean up expired location history
      if (this.config.enableHistory) {
        await this.cleanupExpiredHistory();
      }

      this.emit('indexesOptimized');

    } catch (error) {
      console.error('Failed to optimize indexes:', error);
      throw new GeofencingError('Failed to optimize indexes', { originalError: error });
    }
  }

  /**
   * Flush pending location updates
   */
  async flush(): Promise<void> {
    await this.flushBatch();
  }

  /**
   * Private methods
   */

  private startBatchProcessor(): void {
    this.flushTimer = setInterval(() => {
      if (this.locationBatch.length > 0) {
        this.flushBatch().catch(error => {
          console.error('Batch flush error:', error);
          this.stats.errors++;
        });
      }
    }, this.config.flushInterval);
  }

  private async flushBatch(): Promise<void> {
    if (this.locationBatch.length === 0) return;

    const batchToProcess = [...this.locationBatch];
    this.locationBatch = [];

    await this.processBatchChunk(batchToProcess);
  }

  private async processBatchChunk(locations: LocationUpdate[]): Promise<void> {
    try {
      await this.connectionManager.executeWrite(async (service) => {
        // Use pipeline for efficient batch processing
        const pipeline = service.client.pipeline();

        for (const location of locations) {
          // Set current location
          pipeline.call(
            'SET',
            'tourists',
            location.userId,
            'FIELD', 'accuracy', location.accuracy || 0,
            'FIELD', 'timestamp', location.timestamp,
            'FIELD', 'battery', location.battery || 0,
            'FIELD', 'speed', location.speed || 0,
            'FIELD', 'bearing', location.bearing || 0,
            'FIELD', 'deviceId', location.deviceId || '',
            'FIELD', 'networkType', location.networkType || '',
            'EX', this.config.ttl, // Set TTL
            'POINT',
            location.coordinates.latitude,
            location.coordinates.longitude
          );

          // Store in history if enabled
          if (this.config.enableHistory) {
            const historyKey = `history:${location.userId}:${Date.now()}`;
            pipeline.call(
              'SET',
              `history:${location.userId}`,
              historyKey,
              'FIELD', 'accuracy', location.accuracy || 0,
              'FIELD', 'timestamp', location.timestamp,
              'EX', this.config.ttl * 24, // History TTL is longer
              'POINT',
              location.coordinates.latitude,
              location.coordinates.longitude
            );
          }
        }

        return pipeline.exec();
      });

      this.stats.locationsProcessed += locations.length;
      this.stats.batchesProcessed++;
      this.stats.lastFlushTime = Date.now();

      this.emit('batchProcessed', locations.length);

    } catch (error) {
      this.stats.errors++;
      throw error;
    }
  }

  private validateLocationUpdate(location: LocationUpdate): void {
    if (!location.userId || typeof location.userId !== 'string') {
      throw new LocationValidationError('User ID is required');
    }

    if (location.accuracy && (location.accuracy < 0 || location.accuracy > 10000)) {
      throw new LocationValidationError('Accuracy must be between 0 and 10000 meters');
    }

    if (location.battery && (location.battery < 0 || location.battery > 100)) {
      throw new LocationValidationError('Battery level must be between 0 and 100');
    }

    if (location.speed && location.speed < 0) {
      throw new LocationValidationError('Speed cannot be negative');
    }

    if (location.bearing && (location.bearing < 0 || location.bearing > 360)) {
      throw new LocationValidationError('Bearing must be between 0 and 360 degrees');
    }
  }

  private parseLocationFromTile38(userId: string, result: any): LocationPoint | null {
    try {
      const fields = this.parseFields(result);
      const geometry = JSON.parse(result[1]);
      const coords = geometry.coordinates;

      return {
        userId,
        coordinates: {
          latitude: coords[1],
          longitude: coords[0],
        },
        timestamp: fields.timestamp || new Date().toISOString(),
        accuracy: parseFloat(fields.accuracy) || undefined,
        battery: parseFloat(fields.battery) || undefined,
        speed: parseFloat(fields.speed) || undefined,
        bearing: parseFloat(fields.bearing) || undefined,
      };

    } catch (error) {
      console.error('Failed to parse location from Tile38:', error);
      return null;
    }
  }

  private parseLocationHistoryFromTile38(result: any, since?: Date): LocationPoint[] {
    const locations: LocationPoint[] = [];

    if (!result || !Array.isArray(result) || result.length < 2) {
      return locations;
    }

    const objects = result[1];
    if (Array.isArray(objects)) {
      for (let i = 0; i < objects.length; i += 2) {
        const locationId = objects[i];
        const locationData = objects[i + 1];

        if (locationId && locationData) {
          const location = this.parseLocationFromTile38(
            locationId.split(':')[1], // Extract userId from history key
            [null, locationData]
          );

          if (location) {
            // Filter by timestamp if specified
            if (!since || new Date(location.timestamp) >= since) {
              locations.push(location);
            }
          }
        }
      }
    }

    return locations;
  }

  private parseLocationsFromScanResult(result: any): LocationPoint[] {
    const locations: LocationPoint[] = [];

    if (!result || !Array.isArray(result) || result.length < 2) {
      return locations;
    }

    const objects = result[1];
    if (Array.isArray(objects)) {
      for (let i = 0; i < objects.length; i += 2) {
        const userId = objects[i];
        const locationData = objects[i + 1];

        if (userId && locationData) {
          const location = this.parseLocationFromTile38(userId, [null, locationData]);
          if (location) {
            locations.push(location);
          }
        }
      }
    }

    return locations;
  }

  private formatNearbyResponse(result: any, options?: LocationQueryOptions): NearbyResponse {
    const locations: (LocationPoint & { distance?: number })[] = [];

    if (result && Array.isArray(result) && result.length > 1) {
      const objects = result[1];

      if (Array.isArray(objects)) {
        for (let i = 0; i < objects.length; i += 2) {
          const userId = objects[i];
          const locationData = objects[i + 1];

          if (userId && locationData) {
            const location = this.parseLocationFromTile38(userId, [null, locationData]);
            if (location) {
              // Add distance if available
              if (options?.includeDistance && locationData.distance) {
                (location as any).distance = locationData.distance;
              }
              locations.push(location);
            }
          }
        }
      }
    }

    // Sort by distance if requested
    if (options?.sortByDistance && options?.includeDistance) {
      locations.sort((a, b) => ((a as any).distance || 0) - ((b as any).distance || 0));
    }

    return {
      objects: locations,
      count: locations.length,
      cursor: 0,
      elapsed: result?.elapsed || '0',
    };
  }

  private formatWithinResponse(result: any, options?: LocationQueryOptions): WithinResponse {
    return this.formatNearbyResponse(result, options) as WithinResponse;
  }

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

  private async calculateAverageAccuracy(): Promise<number> {
    try {
      // This is a simplified calculation
      // In production, you might want to maintain running statistics
      const activeUsers = await this.getActiveUsers(100);
      if (activeUsers.length === 0) return 0;

      const totalAccuracy = activeUsers.reduce((sum, user) => sum + (user.accuracy || 0), 0);
      return Math.round((totalAccuracy / activeUsers.length) * 100) / 100;

    } catch (error) {
      return 0;
    }
  }

  private async cleanupExpiredHistory(): Promise<void> {
    try {
      // Clean up old history entries
      const cutoffTime = Date.now() - (this.config.ttl * 1000 * 24); // 24 hours

      await this.connectionManager.executeWrite(async (service) => {
        // This is a simplified cleanup - in production you'd want more sophisticated logic
        return service.client.call('EXPIRE', 'history:*', this.config.ttl * 24);
      });

    } catch (error) {
      console.error('Failed to cleanup expired history:', error);
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  private setupPerformanceMonitoring(): void {
    setInterval(() => {
      this.emit('performanceStats', {
        locationsProcessed: this.stats.locationsProcessed,
        batchesProcessed: this.stats.batchesProcessed,
        errors: this.stats.errors,
        batchSize: this.locationBatch.length,
      });
    }, 10000); // Every 10 seconds
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    console.log('Shutting down Location Indexing Service...');

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Flush any remaining locations
    await this.flushBatch();

    this.emit('shutdown');
    console.log('Location Indexing Service shutdown complete');
  }

  /**
   * Get service health status
   */
  async getHealthStatus(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    pendingBatch: number;
    processed: number;
    errors: number;
    lastFlush: Date;
  }> {
    return {
      status: this.stats.errors > 10 ? 'unhealthy' :
             this.locationBatch.length > this.config.batchSize * 2 ? 'degraded' : 'healthy',
      pendingBatch: this.locationBatch.length,
      processed: this.stats.locationsProcessed,
      errors: this.stats.errors,
      lastFlush: new Date(this.stats.lastFlushTime),
    };
  }
}