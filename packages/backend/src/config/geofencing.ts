/**
 * Geofencing Service Configuration
 *
 * This module provides configuration management for the Tile38 geofencing service,
 * with environment-specific settings for development, production, and testing.
 */

import { GeofencingServiceConfig, Tile38Config } from '../types/geofencing';

export class GeofencingConfig {
  private static instance: GeofencingConfig;
  private config: GeofencingServiceConfig;

  private constructor() {
    this.config = this.loadConfig();
  }

  public static getInstance(): GeofencingConfig {
    if (!GeofencingConfig.instance) {
      GeofencingConfig.instance = new GeofencingConfig();
    }
    return GeofencingConfig.instance;
  }

  public getConfig(): GeofencingServiceConfig {
    return this.config;
  }

  public getTile38Config(): Tile38Config {
    return this.config.tile38;
  }

  private loadConfig(): GeofencingServiceConfig {
    const environment = process.env.NODE_ENV || 'development';

    // Base configuration
    const baseConfig: GeofencingServiceConfig = {
      tile38: {
        host: process.env.TILE38_HOST || 'localhost',
        port: parseInt(process.env.TILE38_PORT || '9851'),
        password: process.env.TILE38_PASSWORD,
        database: parseInt(process.env.TILE38_DB || '0'),
        maxRetriesPerRequest: 3,
        retryDelayOnClusterDown: 100,
        retryDelayOnFailover: 100,
        maxRetriesPerCluster: 3,
        enableReadyCheck: true,
        lazyConnect: true,
        keepAlive: 30000,
      },
      collections: {
        tourists: process.env.TILE38_TOURISTS_COLLECTION || 'tourists',
        zones: process.env.TILE38_ZONES_COLLECTION || 'zones',
        events: process.env.TILE38_EVENTS_COLLECTION || 'events',
      },
      performance: {
        maxConcurrentQueries: parseInt(process.env.TILE38_MAX_CONCURRENT_QUERIES || '100'),
        queryTimeout: parseInt(process.env.TILE38_QUERY_TIMEOUT || '5000'),
        batchSize: parseInt(process.env.TILE38_BATCH_SIZE || '1000'),
        enableCaching: process.env.TILE38_ENABLE_CACHING === 'true',
        cacheTimeout: parseInt(process.env.TILE38_CACHE_TIMEOUT || '300'),
      },
      webhooks: {
        enabled: process.env.WEBHOOKS_ENABLED !== 'false',
        timeout: parseInt(process.env.WEBHOOK_TIMEOUT || '10000'),
        maxConcurrent: parseInt(process.env.WEBHOOK_MAX_CONCURRENT || '10'),
        queueEnabled: process.env.WEBHOOK_QUEUE_ENABLED === 'true',
        queueSize: parseInt(process.env.WEBHOOK_QUEUE_SIZE || '1000'),
      },
    };

    // Environment-specific overrides
    switch (environment) {
      case 'production':
        return {
          ...baseConfig,
          tile38: {
            ...baseConfig.tile38,
            maxRetriesPerRequest: 5,
            retryDelayOnClusterDown: 500,
            retryDelayOnFailover: 500,
            maxRetriesPerCluster: 5,
            keepAlive: 60000,
          },
          performance: {
            ...baseConfig.performance,
            maxConcurrentQueries: 1000,
            queryTimeout: 3000, // Stricter timeout for production
            batchSize: 5000,
            enableCaching: true,
            cacheTimeout: 600,
          },
          webhooks: {
            ...baseConfig.webhooks,
            timeout: 5000, // Shorter timeout for production reliability
            maxConcurrent: 50,
            queueEnabled: true,
            queueSize: 10000,
          },
        };

      case 'test':
        return {
          ...baseConfig,
          tile38: {
            ...baseConfig.tile38,
            host: 'localhost',
            port: 9852, // Different port for testing
            database: 1, // Different database for testing
            maxRetriesPerRequest: 1,
          },
          performance: {
            ...baseConfig.performance,
            maxConcurrentQueries: 10,
            queryTimeout: 1000,
            batchSize: 100,
            enableCaching: false,
          },
          webhooks: {
            ...baseConfig.webhooks,
            enabled: false, // Disable webhooks in tests
          },
        };

      case 'development':
      default:
        return baseConfig;
    }
  }

  public updateConfig(newConfig: Partial<GeofencingServiceConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  public validateConfig(): boolean {
    const { tile38, collections, performance, webhooks } = this.config;

    // Validate Tile38 configuration
    if (!tile38.host || tile38.port < 1 || tile38.port > 65535) {
      throw new Error('Invalid Tile38 host or port configuration');
    }

    // Validate collection names
    if (!collections.tourists || !collections.zones || !collections.events) {
      throw new Error('Collection names must be specified');
    }

    // Validate performance settings
    if (performance.maxConcurrentQueries < 1 || performance.queryTimeout < 100) {
      throw new Error('Invalid performance configuration');
    }

    // Validate webhook settings
    if (webhooks.enabled && (webhooks.timeout < 1000 || webhooks.maxConcurrent < 1)) {
      throw new Error('Invalid webhook configuration');
    }

    return true;
  }

  public getConnectionString(): string {
    const { host, port, password } = this.config.tile38;
    if (password) {
      return `tile38://:${password}@${host}:${port}`;
    }
    return `tile38://${host}:${port}`;
  }

  public isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  public isDevelopment(): boolean {
    return process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
  }

  public isTest(): boolean {
    return process.env.NODE_ENV === 'test';
  }
}

// Export singleton instance
export const geofencingConfig = GeofencingConfig.getInstance();