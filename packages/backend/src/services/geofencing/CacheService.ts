import Redis from 'ioredis';
import { EventEmitter } from 'events';
import { LocationPoint, Zone, GeofenceEvent } from '../../types/geofencing';

interface CacheConfig {
  host: string;
  port: number;
  db: number;
  keyPrefix: string;
  defaultTTL: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  hitRate: number;
  totalOperations: number;
}

export class CacheService extends EventEmitter {
  private client: Redis;
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    hitRate: 0,
    totalOperations: 0
  };

  constructor(private config: CacheConfig) {
    super();

    this.client = new Redis({
      host: config.host,
      port: config.port,
      db: config.db,
      keyPrefix: config.keyPrefix,
      retryDelayOnFailover: 100,
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
      lazyConnect: true
    });

    this.setupEventHandlers();
  }

  /**
   * Setup Redis event handlers
   */
  private setupEventHandlers(): void {
    this.client.on('connect', () => {
      this.emit('connected');
    });

    this.client.on('error', (error) => {
      this.emit('error', error);
    });

    this.client.on('close', () => {
      this.emit('disconnected');
    });
  }

  /**
   * Connect to Redis
   */
  async connect(): Promise<void> {
    await this.client.connect();
  }

  /**
   * Cache location data
   */
  async cacheLocation(userId: string, location: LocationPoint, ttl?: number): Promise<void> {
    const key = this.getLocationKey(userId);
    const value = JSON.stringify(location);
    const expiration = ttl || this.config.defaultTTL;

    try {
      await this.client.setex(key, expiration, value);
      this.stats.sets++;
      this.updateStats();
    } catch (error) {
      this.emit('cacheError', { operation: 'set', key, error });
      throw error;
    }
  }

  /**
   * Get cached location data
   */
  async getCachedLocation(userId: string): Promise<LocationPoint | null> {
    const key = this.getLocationKey(userId);

    try {
      const value = await this.client.get(key);

      if (value) {
        this.stats.hits++;
        this.updateStats();
        return JSON.parse(value) as LocationPoint;
      } else {
        this.stats.misses++;
        this.updateStats();
        return null;
      }
    } catch (error) {
      this.emit('cacheError', { operation: 'get', key, error });
      this.stats.misses++;
      this.updateStats();
      return null;
    }
  }

  /**
   * Cache zone data
   */
  async cacheZone(zoneId: string, zone: Zone, ttl?: number): Promise<void> {
    const key = this.getZoneKey(zoneId);
    const value = JSON.stringify(zone);
    const expiration = ttl || this.config.defaultTTL;

    try {
      await this.client.setex(key, expiration, value);
      this.stats.sets++;
      this.updateStats();
    } catch (error) {
      this.emit('cacheError', { operation: 'set', key, error });
      throw error;
    }
  }

  /**
   * Get cached zone data
   */
  async getCachedZone(zoneId: string): Promise<Zone | null> {
    const key = this.getZoneKey(zoneId);

    try {
      const value = await this.client.get(key);

      if (value) {
        this.stats.hits++;
        this.updateStats();
        return JSON.parse(value) as Zone;
      } else {
        this.stats.misses++;
        this.updateStats();
        return null;
      }
    } catch (error) {
      this.emit('cacheError', { operation: 'get', key, error });
      this.stats.misses++;
      this.updateStats();
      return null;
    }
  }

  /**
   * Cache geofence event results
   */
  async cacheGeofenceEvents(
    userId: string,
    coordinates: { latitude: number; longitude: number },
    events: GeofenceEvent[],
    ttl: number = 60
  ): Promise<void> {
    const key = this.getGeofenceEventKey(userId, coordinates);
    const value = JSON.stringify(events);

    try {
      await this.client.setex(key, ttl, value);
      this.stats.sets++;
      this.updateStats();
    } catch (error) {
      this.emit('cacheError', { operation: 'set', key, error });
      throw error;
    }
  }

  /**
   * Get cached geofence events
   */
  async getCachedGeofenceEvents(
    userId: string,
    coordinates: { latitude: number; longitude: number }
  ): Promise<GeofenceEvent[] | null> {
    const key = this.getGeofenceEventKey(userId, coordinates);

    try {
      const value = await this.client.get(key);

      if (value) {
        this.stats.hits++;
        this.updateStats();
        return JSON.parse(value) as GeofenceEvent[];
      } else {
        this.stats.misses++;
        this.updateStats();
        return null;
      }
    } catch (error) {
      this.emit('cacheError', { operation: 'get', key, error });
      this.stats.misses++;
      this.updateStats();
      return null;
    }
  }

  /**
   * Cache nearby search results
   */
  async cacheNearbySearch(
    coordinates: { latitude: number; longitude: number },
    radius: number,
    results: LocationPoint[],
    ttl: number = 300
  ): Promise<void> {
    const key = this.getNearbySearchKey(coordinates, radius);
    const value = JSON.stringify(results);

    try {
      await this.client.setex(key, ttl, value);
      this.stats.sets++;
      this.updateStats();
    } catch (error) {
      this.emit('cacheError', { operation: 'set', key, error });
      throw error;
    }
  }

  /**
   * Get cached nearby search results
   */
  async getCachedNearbySearch(
    coordinates: { latitude: number; longitude: number },
    radius: number
  ): Promise<LocationPoint[] | null> {
    const key = this.getNearbySearchKey(coordinates, radius);

    try {
      const value = await this.client.get(key);

      if (value) {
        this.stats.hits++;
        this.updateStats();
        return JSON.parse(value) as LocationPoint[];
      } else {
        this.stats.misses++;
        this.updateStats();
        return null;
      }
    } catch (error) {
      this.emit('cacheError', { operation: 'get', key, error });
      this.stats.misses++;
      this.updateStats();
      return null;
    }
  }

  /**
   * Invalidate location cache for a user
   */
  async invalidateLocationCache(userId: string): Promise<void> {
    const key = this.getLocationKey(userId);

    try {
      await this.client.del(key);
      this.stats.deletes++;
      this.updateStats();
    } catch (error) {
      this.emit('cacheError', { operation: 'delete', key, error });
      throw error;
    }
  }

  /**
   * Invalidate zone cache
   */
  async invalidateZoneCache(zoneId: string): Promise<void> {
    const key = this.getZoneKey(zoneId);

    try {
      await this.client.del(key);
      this.stats.deletes++;
      this.updateStats();
    } catch (error) {
      this.emit('cacheError', { operation: 'delete', key, error });
      throw error;
    }
  }

  /**
   * Invalidate all caches with a pattern
   */
  async invalidatePattern(pattern: string): Promise<number> {
    try {
      const keys = await this.client.keys(`${this.config.keyPrefix}${pattern}`);

      if (keys.length > 0) {
        const deletedCount = await this.client.del(...keys);
        this.stats.deletes += deletedCount;
        this.updateStats();
        return deletedCount;
      }

      return 0;
    } catch (error) {
      this.emit('cacheError', { operation: 'invalidatePattern', pattern, error });
      throw error;
    }
  }

  /**
   * Batch cache operations
   */
  async batchSet(operations: Array<{
    key: string;
    value: any;
    ttl?: number;
  }>): Promise<void> {
    const pipeline = this.client.pipeline();

    for (const op of operations) {
      const ttl = op.ttl || this.config.defaultTTL;
      pipeline.setex(op.key, ttl, JSON.stringify(op.value));
    }

    try {
      await pipeline.exec();
      this.stats.sets += operations.length;
      this.updateStats();
    } catch (error) {
      this.emit('cacheError', { operation: 'batchSet', error });
      throw error;
    }
  }

  /**
   * Get multiple cached values
   */
  async batchGet(keys: string[]): Promise<Map<string, any>> {
    const pipeline = this.client.pipeline();
    const results = new Map<string, any>();

    for (const key of keys) {
      pipeline.get(key);
    }

    try {
      const responses = await pipeline.exec();

      for (let i = 0; i < keys.length; i++) {
        const [error, value] = responses![i];

        if (!error && value) {
          try {
            results.set(keys[i], JSON.parse(value as string));
            this.stats.hits++;
          } catch (parseError) {
            this.stats.misses++;
          }
        } else {
          this.stats.misses++;
        }
      }

      this.updateStats();
      return results;
    } catch (error) {
      this.emit('cacheError', { operation: 'batchGet', keys, error });
      throw error;
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Reset cache statistics
   */
  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      hitRate: 0,
      totalOperations: 0
    };
  }

  /**
   * Get Redis info
   */
  async getRedisInfo(): Promise<any> {
    return await this.client.info();
  }

  /**
   * Ping Redis server
   */
  async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      return false;
    }
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }

  // Private helper methods for generating cache keys

  private getLocationKey(userId: string): string {
    return `location:${userId}`;
  }

  private getZoneKey(zoneId: string): string {
    return `zone:${zoneId}`;
  }

  private getGeofenceEventKey(
    userId: string,
    coordinates: { latitude: number; longitude: number }
  ): string {
    const lat = coordinates.latitude.toFixed(6);
    const lon = coordinates.longitude.toFixed(6);
    return `geofence:${userId}:${lat}:${lon}`;
  }

  private getNearbySearchKey(
    coordinates: { latitude: number; longitude: number },
    radius: number
  ): string {
    const lat = coordinates.latitude.toFixed(6);
    const lon = coordinates.longitude.toFixed(6);
    return `nearby:${lat}:${lon}:${radius}`;
  }

  private updateStats(): void {
    this.stats.totalOperations = this.stats.hits + this.stats.misses + this.stats.sets + this.stats.deletes;
    this.stats.hitRate = this.stats.totalOperations > 0
      ? this.stats.hits / (this.stats.hits + this.stats.misses)
      : 0;
  }
}