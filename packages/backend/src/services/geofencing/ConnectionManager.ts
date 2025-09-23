/**
 * Connection Manager for Tile38 Service
 *
 * Manages connection pooling, load balancing, and health monitoring
 * for high-performance geofencing operations with 10,000+ concurrent users.
 */

import { EventEmitter } from 'events';
import { Tile38Service } from './Tile38Service';
import {
  GeofencingServiceConfig,
  HealthCheckResult,
  Tile38ConnectionError,
} from '../../types/geofencing';
import { geofencingConfig } from '../../config/geofencing';

interface ConnectionPool {
  primary: Tile38Service;
  replicas: Tile38Service[];
  lastHealthCheck: Date;
  roundRobinIndex: number;
}

export class ConnectionManager extends EventEmitter {
  private pool: ConnectionPool;
  private config: GeofencingServiceConfig;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private readonly HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
  private readonly MAX_CONNECTION_ATTEMPTS = 3;

  constructor(config?: Partial<GeofencingServiceConfig>) {
    super();
    this.config = config ? { ...geofencingConfig.getConfig(), ...config } : geofencingConfig.getConfig();
    this.pool = {
      primary: new Tile38Service(this.config),
      replicas: [],
      lastHealthCheck: new Date(),
      roundRobinIndex: 0,
    };

    this.initialize();
  }

  /**
   * Initialize the connection manager
   */
  private async initialize(): Promise<void> {
    try {
      // Set up primary connection event handlers
      this.setupConnectionEventHandlers(this.pool.primary, 'primary');

      // Wait for primary connection to be ready
      await this.waitForConnection(this.pool.primary);

      // Initialize replicas if configured
      await this.initializeReplicas();

      // Start health monitoring
      this.startHealthMonitoring();

      this.emit('ready');
      console.log('Connection Manager initialized successfully');
    } catch (error) {
      this.emit('error', error);
      throw new Tile38ConnectionError('Failed to initialize Connection Manager', { originalError: error });
    }
  }

  /**
   * Initialize replica connections for read scaling
   */
  private async initializeReplicas(): Promise<void> {
    const replicaCount = parseInt(process.env.TILE38_REPLICA_COUNT || '0');

    if (replicaCount > 0) {
      console.log(`Initializing ${replicaCount} replica connections...`);

      for (let i = 0; i < replicaCount; i++) {
        try {
          const replicaConfig = {
            ...this.config,
            tile38: {
              ...this.config.tile38,
              host: process.env[`TILE38_REPLICA_${i + 1}_HOST`] || this.config.tile38.host,
              port: parseInt(process.env[`TILE38_REPLICA_${i + 1}_PORT`] || this.config.tile38.port.toString()),
            },
          };

          const replica = new Tile38Service(replicaConfig);
          this.setupConnectionEventHandlers(replica, `replica-${i + 1}`);

          await this.waitForConnection(replica);
          this.pool.replicas.push(replica);

          console.log(`Replica ${i + 1} connected successfully`);
        } catch (error) {
          console.warn(`Failed to connect replica ${i + 1}:`, error);
          // Continue with other replicas even if one fails
        }
      }
    }
  }

  /**
   * Set up event handlers for a connection
   */
  private setupConnectionEventHandlers(service: Tile38Service, identifier: string): void {
    service.on('ready', () => {
      console.log(`${identifier} connection ready`);
      this.emit(`${identifier}-ready`);
    });

    service.on('error', (error) => {
      console.error(`${identifier} connection error:`, error);
      this.emit(`${identifier}-error`, error);
      this.handleConnectionError(service, identifier);
    });

    service.on('disconnected', () => {
      console.warn(`${identifier} connection disconnected`);
      this.emit(`${identifier}-disconnected`);
    });

    service.on('reconnecting', () => {
      console.log(`${identifier} connection reconnecting...`);
      this.emit(`${identifier}-reconnecting`);
    });
  }

  /**
   * Wait for a connection to be ready
   */
  private async waitForConnection(service: Tile38Service): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 30000); // 30 second timeout

      if (service.isServiceConnected()) {
        clearTimeout(timeout);
        resolve();
        return;
      }

      service.once('ready', () => {
        clearTimeout(timeout);
        resolve();
      });

      service.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  /**
   * Handle connection errors with automatic failover
   */
  private async handleConnectionError(service: Tile38Service, identifier: string): Promise<void> {
    if (identifier === 'primary') {
      // For primary connection errors, try to failover to a healthy replica
      const healthyReplica = await this.findHealthyReplica();
      if (healthyReplica) {
        console.log('Failing over to healthy replica for write operations');
        this.emit('primary-failover', healthyReplica);
      } else {
        console.error('No healthy replicas available for failover');
        this.emit('all-connections-failed');
      }
    }
  }

  /**
   * Get a connection for read operations (with load balancing)
   */
  public getReadConnection(): Tile38Service {
    // Include primary and all healthy replicas for read operations
    const availableConnections = [
      this.pool.primary,
      ...this.pool.replicas.filter(replica => replica.isServiceConnected())
    ].filter(conn => conn.isServiceConnected());

    if (availableConnections.length === 0) {
      throw new Tile38ConnectionError('No healthy connections available for read operations');
    }

    // Round-robin load balancing
    const connection = availableConnections[this.pool.roundRobinIndex % availableConnections.length];
    this.pool.roundRobinIndex++;

    return connection;
  }

  /**
   * Get a connection for write operations (always use primary)
   */
  public getWriteConnection(): Tile38Service {
    if (!this.pool.primary.isServiceConnected()) {
      throw new Tile38ConnectionError('Primary connection not available for write operations');
    }

    return this.pool.primary;
  }

  /**
   * Execute a read operation with automatic retry and failover
   */
  public async executeRead<T>(operation: (service: Tile38Service) => Promise<T>): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.MAX_CONNECTION_ATTEMPTS; attempt++) {
      try {
        const connection = this.getReadConnection();
        return await operation(connection);
      } catch (error) {
        lastError = error as Error;
        console.warn(`Read operation attempt ${attempt + 1} failed:`, error);

        if (attempt < this.MAX_CONNECTION_ATTEMPTS - 1) {
          await this.delay(1000 * (attempt + 1)); // Exponential backoff
        }
      }
    }

    throw new Tile38ConnectionError('All read operation attempts failed', { originalError: lastError });
  }

  /**
   * Execute a write operation with automatic retry
   */
  public async executeWrite<T>(operation: (service: Tile38Service) => Promise<T>): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.MAX_CONNECTION_ATTEMPTS; attempt++) {
      try {
        const connection = this.getWriteConnection();
        return await operation(connection);
      } catch (error) {
        lastError = error as Error;
        console.warn(`Write operation attempt ${attempt + 1} failed:`, error);

        if (attempt < this.MAX_CONNECTION_ATTEMPTS - 1) {
          await this.delay(1000 * (attempt + 1)); // Exponential backoff
        }
      }
    }

    throw new Tile38ConnectionError('All write operation attempts failed', { originalError: lastError });
  }

  /**
   * Find a healthy replica for failover
   */
  private async findHealthyReplica(): Promise<Tile38Service | null> {
    for (const replica of this.pool.replicas) {
      if (replica.isServiceConnected()) {
        try {
          const health = await replica.getHealthStatus();
          if (health.status === 'healthy') {
            return replica;
          }
        } catch (error) {
          console.warn('Health check failed for replica:', error);
        }
      }
    }
    return null;
  }

  /**
   * Start health monitoring for all connections
   */
  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthChecks();
    }, this.HEALTH_CHECK_INTERVAL);

    console.log('Health monitoring started');
  }

  /**
   * Perform health checks on all connections
   */
  private async performHealthChecks(): Promise<void> {
    this.pool.lastHealthCheck = new Date();

    // Check primary connection
    try {
      const primaryHealth = await this.pool.primary.getHealthStatus();
      this.emit('health-check', { type: 'primary', health: primaryHealth });
    } catch (error) {
      console.error('Primary health check failed:', error);
      this.emit('health-check-failed', { type: 'primary', error });
    }

    // Check replica connections
    for (let i = 0; i < this.pool.replicas.length; i++) {
      try {
        const replicaHealth = await this.pool.replicas[i].getHealthStatus();
        this.emit('health-check', { type: `replica-${i + 1}`, health: replicaHealth });
      } catch (error) {
        console.error(`Replica ${i + 1} health check failed:`, error);
        this.emit('health-check-failed', { type: `replica-${i + 1}`, error });
      }
    }
  }

  /**
   * Get comprehensive health status for all connections
   */
  public async getOverallHealthStatus(): Promise<{
    overall: 'healthy' | 'degraded' | 'unhealthy';
    primary: HealthCheckResult;
    replicas: HealthCheckResult[];
    summary: {
      totalConnections: number;
      healthyConnections: number;
      degradedConnections: number;
      unhealthyConnections: number;
    };
  }> {
    const primary = await this.pool.primary.getHealthStatus();
    const replicas = await Promise.all(
      this.pool.replicas.map(replica => replica.getHealthStatus().catch(() => ({
        status: 'unhealthy' as const,
        tile38: { connected: false, latency: -1, memory: 'unknown', clients: 0 },
        collections: {},
        performance: { averageQueryTime: -1, requestsPerSecond: 0, errorRate: 100 },
        timestamp: new Date().toISOString(),
      })))
    );

    const allHealth = [primary, ...replicas];
    const healthyCount = allHealth.filter(h => h.status === 'healthy').length;
    const degradedCount = allHealth.filter(h => h.status === 'degraded').length;
    const unhealthyCount = allHealth.filter(h => h.status === 'unhealthy').length;

    let overall: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (primary.status === 'unhealthy' || unhealthyCount > allHealth.length / 2) {
      overall = 'unhealthy';
    } else if (primary.status === 'degraded' || degradedCount > 0) {
      overall = 'degraded';
    }

    return {
      overall,
      primary,
      replicas,
      summary: {
        totalConnections: allHealth.length,
        healthyConnections: healthyCount,
        degradedConnections: degradedCount,
        unhealthyConnections: unhealthyCount,
      },
    };
  }

  /**
   * Get connection pool statistics
   */
  public getPoolStatistics(): {
    primary: { connected: boolean; identifier: string };
    replicas: { connected: boolean; identifier: string }[];
    roundRobinIndex: number;
    lastHealthCheck: Date;
  } {
    return {
      primary: {
        connected: this.pool.primary.isServiceConnected(),
        identifier: 'primary',
      },
      replicas: this.pool.replicas.map((replica, index) => ({
        connected: replica.isServiceConnected(),
        identifier: `replica-${index + 1}`,
      })),
      roundRobinIndex: this.pool.roundRobinIndex,
      lastHealthCheck: this.pool.lastHealthCheck,
    };
  }

  /**
   * Gracefully shutdown all connections
   */
  public async shutdown(): Promise<void> {
    console.log('Shutting down Connection Manager...');

    // Stop health monitoring
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    // Shutdown all connections
    const shutdownPromises: Promise<void>[] = [
      this.pool.primary.shutdown(),
      ...this.pool.replicas.map(replica => replica.shutdown()),
    ];

    try {
      await Promise.all(shutdownPromises);
      console.log('All connections shut down successfully');
    } catch (error) {
      console.error('Error during connection shutdown:', error);
    }

    this.emit('shutdown');
  }

  /**
   * Utility method for delays
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check if the connection manager is ready
   */
  public isReady(): boolean {
    return this.pool.primary.isServiceConnected();
  }

  /**
   * Get the configuration
   */
  public getConfig(): GeofencingServiceConfig {
    return this.config;
  }
}