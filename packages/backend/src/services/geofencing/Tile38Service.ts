/**
 * Tile38 Service Wrapper for Smart Tourist Safety Monitoring System
 *
 * This service provides a high-level interface to Tile38 with connection pooling,
 * error handling, automatic reconnection, and optimized geofencing operations.
 */

import { EventEmitter } from 'events';
import Redis from 'ioredis';
import {
  GeofencingServiceConfig,
  LocationPoint,
  Zone,
  GeofenceEvent,
  NearbyQuery,
  WithinQuery,
  NearbyResponse,
  WithinResponse,
  QueryResponse,
  HealthCheckResult,
  Tile38ConnectionError,
  LocationValidationError,
  ZoneValidationError,
  Coordinate,
  GeofenceEventType,
} from '../../types/geofencing';
import { geofencingConfig } from '../../config/geofencing';
import { PerformanceMonitor } from './PerformanceMonitor';
import { CacheService } from './CacheService';
import { LoadBalancer } from './LoadBalancer';

export class Tile38Service extends EventEmitter {
  private client: Redis;
  private config: GeofencingServiceConfig;
  private isConnected: boolean = false;
  private connectionRetries: number = 0;
  private maxRetries: number = 5;
  private retryDelay: number = 1000;
  private healthStats = {
    requestCount: 0,
    errorCount: 0,
    totalLatency: 0,
    lastHealthCheck: new Date(),
  };
  private performanceMonitor?: PerformanceMonitor;
  private cacheService?: CacheService;
  private loadBalancer?: LoadBalancer;

  constructor(
    config?: Partial<GeofencingServiceConfig>,
    performanceMonitor?: PerformanceMonitor,
    cacheService?: CacheService,
    loadBalancer?: LoadBalancer
  ) {
    super();
    this.config = config ? { ...geofencingConfig.getConfig(), ...config } : geofencingConfig.getConfig();
    this.performanceMonitor = performanceMonitor;
    this.cacheService = cacheService;
    this.loadBalancer = loadBalancer;
    this.initialize();
  }

  /**
   * Initialize the Tile38 connection
   */
  private async initialize(): Promise<void> {
    try {
      await this.connect();
      this.setupEventHandlers();
      this.emit('ready');
    } catch (error) {
      this.emit('error', error);
      throw new Tile38ConnectionError('Failed to initialize Tile38 service', { originalError: error });
    }
  }

  /**
   * Connect to Tile38 server
   */
  private async connect(): Promise<void> {
    try {
      const { host, port, password } = this.config.tile38;

      this.client = new Redis({
        host,
        port,
        password,
        retryDelayOnFailover: this.config.tile38.retryDelayOnFailover,
        maxRetriesPerRequest: this.config.tile38.maxRetriesPerRequest,
        lazyConnect: this.config.tile38.lazyConnect,
        keepAlive: this.config.tile38.keepAlive,
      });

      // Test connection
      const pingResult = await this.client.ping();
      this.isConnected = true;
      this.connectionRetries = 0;

      console.log(`Connected to Tile38 at ${host}:${port}`);
      this.emit('connected');
    } catch (error) {
      this.isConnected = false;
      this.connectionRetries++;

      if (this.connectionRetries < this.maxRetries) {
        console.warn(`Tile38 connection failed, retrying in ${this.retryDelay}ms (attempt ${this.connectionRetries}/${this.maxRetries})`);
        await this.delay(this.retryDelay);
        this.retryDelay *= 2; // Exponential backoff
        return this.connect();
      } else {
        throw new Tile38ConnectionError('Max connection retries exceeded', { originalError: error });
      }
    }
  }

  /**
   * Setup event handlers for connection management
   */
  private setupEventHandlers(): void {
    this.client.on('error', (error: Error) => {
      console.error('Tile38 client error:', error);
      this.isConnected = false;
      this.emit('error', error);
      this.handleReconnection();
    });

    this.client.on('close', () => {
      console.warn('Tile38 connection closed');
      this.isConnected = false;
      this.emit('disconnected');
      this.handleReconnection();
    });

    this.client.on('reconnecting', () => {
      console.log('Tile38 reconnecting...');
      this.emit('reconnecting');
    });
  }

  /**
   * Handle automatic reconnection
   */
  private async handleReconnection(): Promise<void> {
    if (!this.isConnected && this.connectionRetries < this.maxRetries) {
      try {
        await this.delay(this.retryDelay);
        await this.connect();
      } catch (error) {
        console.error('Reconnection failed:', error);
      }
    }
  }

  /**
   * Utility method for delays
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Execute a command with error handling and metrics tracking
   */
  private async executeCommand<T>(operation: string, command: () => Promise<T>): Promise<T> {
    if (!this.isConnected) {
      throw new Tile38ConnectionError('Not connected to Tile38 server');
    }

    const startTime = Date.now();
    const operationId = `${operation}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Start performance monitoring
    if (this.performanceMonitor) {
      this.performanceMonitor.startOperation(operationId, operation);
    }

    this.healthStats.requestCount++;

    try {
      let result: T;

      // Use load balancer if available
      if (this.loadBalancer) {
        result = await this.loadBalancer.execute(command, 0, operation);
      } else {
        result = await Promise.race([
          command(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Query timeout')), this.config.performance.queryTimeout)
          )
        ]);
      }

      const latency = Date.now() - startTime;
      this.healthStats.totalLatency += latency;

      // End performance monitoring
      if (this.performanceMonitor) {
        this.performanceMonitor.endOperation(operationId, operation, true);
      }

      return result;
    } catch (error) {
      this.healthStats.errorCount++;
      console.error(`Tile38 ${operation} error:`, error);

      // End performance monitoring with error
      if (this.performanceMonitor) {
        this.performanceMonitor.endOperation(operationId, operation, false, { error: error.message });
      }

      throw new Tile38ConnectionError(`${operation} failed`, { originalError: error });
    }
  }

  /**
   * Set a location point for a user
   */
  async setLocation(location: LocationPoint): Promise<void> {
    this.validateLocation(location);

    await this.executeCommand('setLocation', async () => {
      const result = await this.client.call(
        'SET',
        this.config.collections.tourists,
        location.userId,
        'POINT',
        location.coordinates.latitude,
        location.coordinates.longitude
      );

      // Cache the location for faster retrieval
      if (this.cacheService) {
        await this.cacheService.cacheLocation(location.userId, location);
      }

      return result;
    });
  }

  /**
   * Get a user's current location
   */
  async getLocation(userId: string): Promise<LocationPoint | null> {
    // Try cache first
    if (this.cacheService) {
      const cachedLocation = await this.cacheService.getCachedLocation(userId);
      if (cachedLocation) {
        return cachedLocation;
      }
    }

    const result = await this.executeCommand('getLocation', async () => {
      return this.client.call('GET', this.config.collections.tourists, userId, 'WITHFIELDS');
    });

    if (!result || result.length < 2 || !result[1]) {
      return null;
    }

    try {
      // Tile38 returns: [1, '{"type":"Point","coordinates":[77.2295,28.6129]}']
      const geoJsonStr = result[1];
      const geoJson = JSON.parse(geoJsonStr);
      const coords = geoJson.coordinates;

      const location: LocationPoint = {
        userId,
        coordinates: {
          latitude: coords[1],  // Tile38 stores as [lon, lat]
          longitude: coords[0],
        },
        timestamp: new Date().toISOString(),
      };

      // Cache the result for future requests
      if (this.cacheService) {
        await this.cacheService.cacheLocation(userId, location);
      }

      return location;
    } catch (error) {
      console.error('Failed to parse Tile38 response:', result, error);
      return null;
    }
  }

  /**
   * Set multiple locations in a batch operation
   */
  async setBatchLocations(locations: LocationPoint[]): Promise<void> {
    if (locations.length === 0) return;

    // Process in batches to avoid overwhelming the server
    const batchSize = this.config.performance.batchSize;
    for (let i = 0; i < locations.length; i += batchSize) {
      const batch = locations.slice(i, i + batchSize);

      await this.executeCommand('setBatchLocations', async () => {
        const promises = batch.map(location => {
          this.validateLocation(location);
          return this.client.call(
            'SET',
            this.config.collections.tourists,
            location.userId,
            'POINT',
            location.coordinates.latitude,
            location.coordinates.longitude
          );
        });

        return Promise.all(promises);
      });
    }
  }

  /**
   * Find users near a specific point
   */
  async findNearby(query: NearbyQuery): Promise<NearbyResponse> {
    // Try cache first for nearby searches
    if (this.cacheService) {
      const cachedResults = await this.cacheService.getCachedNearbySearch(
        query.center,
        query.radius
      );
      if (cachedResults) {
        return {
          objects: cachedResults,
          count: cachedResults.length,
          cursor: 0,
          elapsed: '0ms'
        };
      }
    }

    const result = await this.executeCommand('findNearby', async () => {
      return this.client.call(
        'NEARBY',
        this.config.collections.tourists,
        'LIMIT',
        query.limit || 100,
        'POINT',
        query.center.latitude,
        query.center.longitude,
        query.radius
      );
    });

    const formattedResponse = this.formatQueryResponse(result);

    // Cache the results
    if (this.cacheService && formattedResponse.objects) {
      await this.cacheService.cacheNearbySearch(
        query.center,
        query.radius,
        formattedResponse.objects
      );
    }

    return formattedResponse;
  }

  /**
   * Find users within a specific area
   */
  async findWithin(query: WithinQuery): Promise<WithinResponse> {
    const result = await this.executeCommand('findWithin', async () => {
      if ('minLat' in query.bounds) {
        // Bounding box query
        const { minLat, minLon, maxLat, maxLon } = query.bounds;
        return this.client.within(this.config.collections.tourists, 'bounds', minLat, minLon, maxLat, maxLon)
          .limit(query.limit || 100);
      } else {
        // Polygon query
        const coords = query.bounds as Coordinate[];
        return this.client.within(this.config.collections.tourists, 'polygon', coords)
          .limit(query.limit || 100);
      }
    });

    return this.formatQueryResponse(result);
  }

  /**
   * Set up a geofence webhook
   */
  async setGeofenceHook(
    hookName: string,
    webhookUrl: string,
    zoneId: string,
    coordinates: Coordinate[]
  ): Promise<void> {
    await this.executeCommand('setGeofenceHook', async () => {
      return this.client.sethook(
        hookName,
        webhookUrl,
        'within',
        this.config.collections.tourists,
        'polygon',
        coordinates.map(c => [c.longitude, c.latitude]).flat()
      );
    });
  }

  /**
   * Remove a geofence webhook
   */
  async removeGeofenceHook(hookName: string): Promise<void> {
    await this.executeCommand('removeGeofenceHook', async () => {
      return this.client.pdelhook(hookName);
    });
  }

  /**
   * Get all active webhooks
   */
  async getActiveHooks(): Promise<any[]> {
    return this.executeCommand('getActiveHooks', async () => {
      return this.client.hooks();
    });
  }

  /**
   * Check for geofence events for a user at specific coordinates
   */
  async checkGeofenceEvents(
    userId: string,
    coordinates: { latitude: number; longitude: number }
  ): Promise<GeofenceEvent[]> {
    // Try cache first
    if (this.cacheService) {
      const cachedEvents = await this.cacheService.getCachedGeofenceEvents(userId, coordinates);
      if (cachedEvents) {
        return cachedEvents;
      }
    }

    const events: GeofenceEvent[] = [];

    try {
      // Find all zones that contain this point
      const result = await this.executeCommand('checkGeofenceEvents', async () => {
        return this.client.call(
          'INTERSECTS',
          this.config.collections.zones,
          'POINT',
          coordinates.latitude,
          coordinates.longitude
        );
      });

      if (result && result.objects) {
        for (const zoneData of result.objects) {
          const event: GeofenceEvent = {
            id: `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            userId,
            zoneId: zoneData.id,
            eventType: 'enter' as GeofenceEventType, // Would need logic to determine enter/exit
            coordinates,
            timestamp: new Date().toISOString(),
            metadata: {
              zoneName: zoneData.id,
              eventSource: 'tile38_intersects'
            }
          };
          events.push(event);
        }
      }

      // Cache the results
      if (this.cacheService) {
        await this.cacheService.cacheGeofenceEvents(userId, coordinates, events);
      }

      return events;
    } catch (error) {
      console.error('Error checking geofence events:', error);
      return [];
    }
  }

  /**
   * Create a zone for geofencing
   */
  async createZone(zone: Zone): Promise<void> {
    this.validateZone(zone);

    await this.executeCommand('createZone', async () => {
      const polygonCoords = zone.coordinates.map(c => [c.longitude, c.latitude]).flat();
      const result = await this.client.call(
        'SET',
        this.config.collections.zones,
        zone.id,
        'OBJECT',
        JSON.stringify({
          type: 'Polygon',
          coordinates: [zone.coordinates.map(c => [c.longitude, c.latitude])]
        })
      );

      // Cache the zone
      if (this.cacheService) {
        await this.cacheService.cacheZone(zone.id, zone);
      }

      return result;
    });
  }

  /**
   * Get zone information
   */
  async getZone(zoneId: string): Promise<Zone | null> {
    const result = await this.executeCommand('getZone', async () => {
      return this.client.get(this.config.collections.zones, zoneId);
    });

    if (!result || !result.object) {
      return null;
    }

    // Convert Tile38 response back to Zone format
    // This would need additional metadata stored elsewhere or in the object itself
    return null; // Placeholder - would need full implementation
  }

  /**
   * Delete a zone
   */
  async deleteZone(zoneId: string): Promise<void> {
    await this.executeCommand('deleteZone', async () => {
      return this.client.del(this.config.collections.zones, zoneId);
    });
  }

  /**
   * Get service health status
   */
  async getHealthStatus(): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      const pingResult = await this.client.ping();
      const latency = Date.now() - startTime;

      const serverInfo = await this.client.server();
      const stats = await this.client.stats(this.config.collections.tourists);

      const avgQueryTime = this.healthStats.requestCount > 0
        ? this.healthStats.totalLatency / this.healthStats.requestCount
        : 0;

      const errorRate = this.healthStats.requestCount > 0
        ? (this.healthStats.errorCount / this.healthStats.requestCount) * 100
        : 0;

      return {
        status: this.isConnected ? 'healthy' : 'unhealthy',
        tile38: {
          connected: this.isConnected,
          latency,
          memory: serverInfo.stats?.heap_size || 'unknown',
          clients: serverInfo.stats?.connected_clients || 0,
        },
        collections: {
          [this.config.collections.tourists]: {
            count: stats?.in_memory_size || 0,
            lastUpdated: new Date().toISOString(),
          },
        },
        performance: {
          averageQueryTime: avgQueryTime,
          requestsPerSecond: this.calculateRequestsPerSecond(),
          errorRate,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        tile38: {
          connected: false,
          latency: -1,
          memory: 'unknown',
          clients: 0,
        },
        collections: {},
        performance: {
          averageQueryTime: -1,
          requestsPerSecond: 0,
          errorRate: 100,
        },
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Gracefully shutdown the service
   */
  async shutdown(): Promise<void> {
    try {
      if (this.client) {
        await this.client.quit();
      }
      this.isConnected = false;
      this.emit('shutdown');
      console.log('Tile38 service shutdown complete');
    } catch (error) {
      console.error('Error during Tile38 service shutdown:', error);
    }
  }

  /**
   * Validate location data
   */
  private validateLocation(location: LocationPoint): void {
    if (!location.userId || typeof location.userId !== 'string') {
      throw new LocationValidationError('Invalid or missing userId');
    }

    if (!location.coordinates) {
      throw new LocationValidationError('Missing coordinates');
    }

    const { latitude, longitude } = location.coordinates;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      throw new LocationValidationError('Coordinates must be numbers');
    }

    if (latitude < -90 || latitude > 90) {
      throw new LocationValidationError('Latitude must be between -90 and 90');
    }

    if (longitude < -180 || longitude > 180) {
      throw new LocationValidationError('Longitude must be between -180 and 180');
    }
  }

  /**
   * Validate zone data
   */
  private validateZone(zone: Zone): void {
    if (!zone.id || typeof zone.id !== 'string') {
      throw new ZoneValidationError('Invalid or missing zone ID');
    }

    if (!zone.coordinates || !Array.isArray(zone.coordinates)) {
      throw new ZoneValidationError('Zone coordinates must be an array');
    }

    if (zone.coordinates.length < 3) {
      throw new ZoneValidationError('Zone must have at least 3 coordinates');
    }

    zone.coordinates.forEach((coord, index) => {
      if (!coord.latitude || !coord.longitude) {
        throw new ZoneValidationError(`Invalid coordinate at index ${index}`);
      }
    });
  }

  /**
   * Format query response to match our interface
   */
  private formatQueryResponse(result: any): any {
    return {
      objects: result.objects || [],
      count: result.count || 0,
      cursor: result.cursor || 0,
      elapsed: result.elapsed || '0',
    };
  }

  /**
   * Calculate requests per second
   */
  private calculateRequestsPerSecond(): number {
    const timeDiff = Date.now() - this.healthStats.lastHealthCheck.getTime();
    const seconds = timeDiff / 1000;
    return seconds > 0 ? this.healthStats.requestCount / seconds : 0;
  }

  /**
   * Check if service is connected
   */
  public isServiceConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Get service configuration
   */
  public getServiceConfig(): GeofencingServiceConfig {
    return this.config;
  }
}