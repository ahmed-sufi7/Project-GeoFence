/**
 * Geofencing Orchestrator - Main service that coordinates all geofencing operations
 *
 * This service integrates all the geofencing components and provides a unified interface
 * for high-performance location tracking, zone management, and event processing.
 */

import { EventEmitter } from 'events';
import { Tile38Service } from './Tile38Service';
import { ZoneManagementService } from './ZoneManagementService';
import { LocationIndexingService } from './LocationIndexingService';
import { GeofenceWebhookService } from './GeofenceWebhookService';
import { BulkLocationProcessor } from './BulkLocationProcessor';
import { PerformanceMonitor } from './PerformanceMonitor';
import { CacheService } from './CacheService';
import { LoadBalancer } from './LoadBalancer';
import { ConnectionManager } from './ConnectionManager';
import { SupabaseIntegrationService } from './SupabaseIntegrationService';
import { DistanceCalculationService } from './DistanceCalculationService';
import {
  LocationPoint,
  Zone,
  GeofenceEvent,
  BulkLocationUpdate,
  ProcessingStats,
  HealthCheckResult,
  NearbyQuery,
  WithinQuery,
  GeofencingServiceConfig,
  Coordinate
} from '../../types/geofencing';
import { geofencingConfig } from '../../config/geofencing';

interface OrchestratorConfig {
  enablePerformanceMonitoring: boolean;
  enableCaching: boolean;
  enableLoadBalancing: boolean;
  enableSupabaseIntegration: boolean;
  redis?: {
    host: string;
    port: number;
    db: number;
  };
  supabase?: {
    url: string;
    anonKey: string;
    serviceRoleKey?: string;
  };
}

export class GeofencingOrchestrator extends EventEmitter {
  // Core services
  private tile38Service: Tile38Service;
  private zoneService: ZoneManagementService;
  private locationService: LocationIndexingService;
  private webhookService: GeofenceWebhookService;
  private bulkProcessor: BulkLocationProcessor;

  // Performance and optimization services
  private performanceMonitor?: PerformanceMonitor;
  private cacheService?: CacheService;
  private loadBalancer?: LoadBalancer;
  private connectionManager: ConnectionManager;

  // Integration services
  private supabaseService?: SupabaseIntegrationService;
  private distanceService: DistanceCalculationService;

  private isInitialized = false;
  private config: GeofencingServiceConfig;
  private orchestratorConfig: OrchestratorConfig;

  constructor(
    config?: Partial<GeofencingServiceConfig>,
    orchestratorConfig: OrchestratorConfig = {
      enablePerformanceMonitoring: true,
      enableCaching: true,
      enableLoadBalancing: true,
      enableSupabaseIntegration: false,
      redis: {
        host: 'localhost',
        port: 6379,
        db: 1
      },
      supabase: {
        url: process.env.SUPABASE_URL || '',
        anonKey: process.env.SUPABASE_ANON_KEY || '',
        serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
      }
    }
  ) {
    super();
    this.config = config ? { ...geofencingConfig.getConfig(), ...config } : geofencingConfig.getConfig();
    this.orchestratorConfig = orchestratorConfig;
    this.setupServices();
  }

  /**
   * Setup all services with proper dependency injection
   */
  private async setupServices(): Promise<void> {
    try {
      // Initialize connection manager
      this.connectionManager = new ConnectionManager(this.config);

      // Initialize performance monitoring if enabled
      if (this.orchestratorConfig.enablePerformanceMonitoring) {
        this.performanceMonitor = new PerformanceMonitor();
        this.setupPerformanceMonitoring();
      }

      // Initialize caching if enabled
      if (this.orchestratorConfig.enableCaching && this.orchestratorConfig.redis) {
        this.cacheService = new CacheService({
          host: this.orchestratorConfig.redis.host,
          port: this.orchestratorConfig.redis.port,
          db: this.orchestratorConfig.redis.db,
          keyPrefix: 'geofencing:',
          defaultTTL: 300
        });
        await this.cacheService.connect();
      }

      // Initialize load balancer if enabled
      if (this.orchestratorConfig.enableLoadBalancing) {
        this.loadBalancer = new LoadBalancer(
          this.connectionManager,
          this.performanceMonitor!
        );
      }

      // Initialize Supabase integration if enabled
      if (this.orchestratorConfig.enableSupabaseIntegration && this.orchestratorConfig.supabase) {
        this.supabaseService = new SupabaseIntegrationService(this.orchestratorConfig.supabase);
        await this.supabaseService.initialize();
      }

      // Initialize distance calculation service
      this.distanceService = new DistanceCalculationService(
        undefined, // Tile38Service will be set later
        this.cacheService,
        this.performanceMonitor
      );

      // Initialize core services
      this.tile38Service = new Tile38Service(
        this.config,
        this.performanceMonitor,
        this.cacheService,
        this.loadBalancer
      );

      this.zoneService = new ZoneManagementService(this.tile38Service);
      this.locationService = new LocationIndexingService(this.tile38Service);
      this.webhookService = new GeofenceWebhookService();

      this.bulkProcessor = new BulkLocationProcessor(
        this.tile38Service,
        this.connectionManager,
        this.webhookService
      );

      // Setup event handlers
      this.setupEventHandlers();

      this.isInitialized = true;
      this.emit('initialized');
    } catch (error) {
      console.error('Failed to setup GeofencingOrchestrator:', error);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Setup performance monitoring event handlers
   */
  private setupPerformanceMonitoring(): void {
    if (!this.performanceMonitor) return;

    this.performanceMonitor.on('performanceAlert', (alert) => {
      console.warn(`Performance alert: ${alert.operation} took ${alert.duration}ms (threshold: ${alert.threshold}ms)`);
      this.emit('performanceAlert', alert);
    });

    this.performanceMonitor.on('metric', (metric) => {
      // Forward performance metrics
      this.emit('performanceMetric', metric);
    });
  }

  /**
   * Setup event handlers for all services
   */
  private setupEventHandlers(): void {
    // Bulk processor events
    this.bulkProcessor.on('queueOverflow', (data) => {
      console.warn(`Bulk processor queue overflow: ${data.queueSize} items`);
      this.emit('queueOverflow', data);
    });

    this.bulkProcessor.on('bulkProcessingComplete', (data) => {
      this.emit('bulkProcessingComplete', data);
    });

    // Cache service events
    if (this.cacheService) {
      this.cacheService.on('error', (error) => {
        console.error('Cache service error:', error);
        this.emit('cacheError', error);
      });
    }

    // Load balancer events
    if (this.loadBalancer) {
      this.loadBalancer.on('queueOverflow', (data) => {
        console.warn(`Load balancer queue overflow: ${data.queueSize} requests`);
        this.emit('loadBalancerOverflow', data);
      });
    }

    // Webhook service events
    this.webhookService.on('webhookDelivered', (data) => {
      this.emit('webhookDelivered', data);
    });

    this.webhookService.on('webhookFailed', (data) => {
      console.error('Webhook delivery failed:', data);
      this.emit('webhookFailed', data);
    });
  }

  /**
   * Process a single location update
   */
  async updateLocation(location: LocationPoint): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('GeofencingOrchestrator not initialized');
    }

    // Update location in Tile38
    await this.locationService.updateLocation(location);

    // Store location history in Supabase if enabled
    if (this.supabaseService) {
      try {
        await this.supabaseService.storeLocationHistory(location);
      } catch (error) {
        console.error('Failed to store location history in Supabase:', error);
        // Don't fail the entire operation if Supabase storage fails
      }
    }

    // Check for geofence events
    const events = await this.tile38Service.checkGeofenceEvents(
      location.userId,
      location.coordinates
    );

    // Store and process events
    for (const event of events) {
      // Store event in Supabase if enabled
      if (this.supabaseService) {
        try {
          await this.supabaseService.storeGeofenceEvent(event);
        } catch (error) {
          console.error('Failed to store geofence event in Supabase:', error);
        }
      }

      // Process events through webhook system
      await this.webhookService.processEvent(event);

      // Update event processing status in Supabase
      if (this.supabaseService) {
        try {
          await this.supabaseService.updateEventProcessingStatus(event.id, true, event.webhookDelivered);
        } catch (error) {
          console.error('Failed to update event processing status in Supabase:', error);
        }
      }
    }
  }

  /**
   * Process bulk location updates
   */
  async processBulkLocations(updates: BulkLocationUpdate[]): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('GeofencingOrchestrator not initialized');
    }

    await this.bulkProcessor.processBulkUpdates(updates);
  }

  /**
   * Queue a location update for bulk processing
   */
  async queueLocationUpdate(location: LocationPoint): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('GeofencingOrchestrator not initialized');
    }

    await this.bulkProcessor.queueLocationUpdate(location);
  }

  /**
   * Create a new geofence zone
   */
  async createZone(zone: Zone): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('GeofencingOrchestrator not initialized');
    }

    await this.zoneService.createZone(zone);
  }

  /**
   * Delete a geofence zone
   */
  async deleteZone(zoneId: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('GeofencingOrchestrator not initialized');
    }

    await this.zoneService.deleteZone(zoneId);

    // Clear related cache entries
    if (this.cacheService) {
      await this.cacheService.invalidateZoneCache(zoneId);
      await this.cacheService.invalidatePattern(`geofence:*:*`);
    }
  }

  /**
   * Get user's current location
   */
  async getUserLocation(userId: string): Promise<LocationPoint | null> {
    if (!this.isInitialized) {
      throw new Error('GeofencingOrchestrator not initialized');
    }

    return await this.tile38Service.getLocation(userId);
  }

  /**
   * Get user location history from Supabase
   */
  async getUserLocationHistory(
    userId: string,
    startTime?: string,
    endTime?: string,
    limit?: number
  ): Promise<LocationPoint[]> {
    if (!this.isInitialized) {
      throw new Error('GeofencingOrchestrator not initialized');
    }

    if (!this.supabaseService) {
      throw new Error('Supabase integration not enabled');
    }

    return await this.supabaseService.getUserLocationHistory(userId, startTime, endTime, limit);
  }

  /**
   * Find nearby users
   */
  async findNearbyUsers(query: NearbyQuery): Promise<LocationPoint[]> {
    if (!this.isInitialized) {
      throw new Error('GeofencingOrchestrator not initialized');
    }

    const result = await this.tile38Service.findNearby(query);
    return result.objects || [];
  }

  /**
   * Find users within a zone
   */
  async findUsersInZone(query: WithinQuery): Promise<LocationPoint[]> {
    if (!this.isInitialized) {
      throw new Error('GeofencingOrchestrator not initialized');
    }

    const result = await this.tile38Service.findWithin(query);
    return result.objects || [];
  }

  /**
   * Get processing statistics
   */
  getProcessingStats(): ProcessingStats {
    if (!this.bulkProcessor) {
      throw new Error('Bulk processor not initialized');
    }

    return this.bulkProcessor.getStats();
  }

  /**
   * Get performance summary
   */
  getPerformanceSummary(): any {
    if (!this.performanceMonitor) {
      return { error: 'Performance monitoring not enabled' };
    }

    return this.performanceMonitor.getPerformanceSummary();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): any {
    if (!this.cacheService) {
      return { error: 'Caching not enabled' };
    }

    return this.cacheService.getStats();
  }

  /**
   * Calculate distance between two points
   */
  async calculateDistance(
    point1: Coordinate,
    point2: Coordinate,
    options?: {
      algorithm?: 'haversine' | 'vincenty' | 'tile38' | 'auto';
      unit?: 'meters' | 'kilometers' | 'miles' | 'feet' | 'nautical_miles';
      precision?: number;
    }
  ): Promise<{
    distance: number;
    unit: string;
    algorithm: string;
    calculationTime: number;
  }> {
    if (!this.isInitialized) {
      throw new Error('GeofencingOrchestrator not initialized');
    }

    const result = await this.distanceService.calculateDistance(point1, point2, options);
    return {
      distance: result.distance,
      unit: result.unit,
      algorithm: result.algorithm,
      calculationTime: result.calculationTime
    };
  }

  /**
   * Calculate distance matrix for multiple points
   */
  async calculateDistanceMatrix(
    origins: Coordinate[],
    destinations: Coordinate[],
    options?: {
      algorithm?: 'haversine' | 'vincenty' | 'tile38' | 'auto';
      unit?: 'meters' | 'kilometers' | 'miles' | 'feet' | 'nautical_miles';
      precision?: number;
    }
  ) {
    if (!this.isInitialized) {
      throw new Error('GeofencingOrchestrator not initialized');
    }

    return await this.distanceService.calculateDistanceMatrix(origins, destinations, options);
  }

  /**
   * Find nearest point to a target location
   */
  async findNearestPoint(
    target: Coordinate,
    points: Coordinate[],
    options?: {
      algorithm?: 'haversine' | 'vincenty' | 'tile38' | 'auto';
      unit?: 'meters' | 'kilometers' | 'miles' | 'feet' | 'nautical_miles';
      precision?: number;
    }
  ) {
    if (!this.isInitialized) {
      throw new Error('GeofencingOrchestrator not initialized');
    }

    return await this.distanceService.findNearestNeighbor(target, points, options);
  }

  /**
   * Sync zones from Supabase to Tile38
   */
  async syncZonesFromSupabase(): Promise<Zone[]> {
    if (!this.isInitialized) {
      throw new Error('GeofencingOrchestrator not initialized');
    }

    if (!this.supabaseService) {
      throw new Error('Supabase integration not enabled');
    }

    const zones = await this.supabaseService.syncZonesFromSupabase();

    // Create zones in Tile38
    for (const zone of zones) {
      await this.tile38Service.createZone(zone);
    }

    return zones;
  }

  /**
   * Get Supabase sync statistics
   */
  getSupabaseSyncStats(): any {
    if (!this.supabaseService) {
      return { error: 'Supabase integration not enabled' };
    }

    return this.supabaseService.getSyncStats();
  }

  /**
   * Get distance calculation statistics
   */
  getDistanceStats(): any {
    return this.distanceService.getStats();
  }

  /**
   * Get comprehensive health status
   */
  async getHealthStatus(): Promise<HealthCheckResult & {
    orchestrator: {
      initialized: boolean;
      services: {
        tile38: boolean;
        zoneManagement: boolean;
        locationIndexing: boolean;
        webhooks: boolean;
        bulkProcessor: boolean;
        performanceMonitor: boolean;
        cache: boolean;
        loadBalancer: boolean;
      };
      processingStats?: ProcessingStats;
      cacheStats?: any;
    };
  }> {
    const baseHealth = await this.tile38Service.getHealthStatus();

    return {
      ...baseHealth,
      orchestrator: {
        initialized: this.isInitialized,
        services: {
          tile38: !!this.tile38Service,
          zoneManagement: !!this.zoneService,
          locationIndexing: !!this.locationService,
          webhooks: !!this.webhookService,
          bulkProcessor: !!this.bulkProcessor,
          performanceMonitor: !!this.performanceMonitor,
          cache: !!this.cacheService,
          loadBalancer: !!this.loadBalancer
        },
        processingStats: this.bulkProcessor ? this.bulkProcessor.getStats() : undefined,
        cacheStats: this.cacheService ? this.cacheService.getStats() : undefined
      }
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    console.log('Shutting down GeofencingOrchestrator...');

    try {
      // Shutdown bulk processor first to finish pending operations
      if (this.bulkProcessor) {
        await this.bulkProcessor.shutdown();
      }

      // Shutdown load balancer
      if (this.loadBalancer) {
        await this.loadBalancer.shutdown();
      }

      // Shutdown performance monitor
      if (this.performanceMonitor) {
        this.performanceMonitor.shutdown();
      }

      // Disconnect cache service
      if (this.cacheService) {
        await this.cacheService.disconnect();
      }

      // Shutdown webhook service
      if (this.webhookService) {
        await this.webhookService.shutdown();
      }

      // Shutdown connection manager
      if (this.connectionManager) {
        await this.connectionManager.shutdown();
      }

      // Shutdown core Tile38 service last
      if (this.tile38Service) {
        await this.tile38Service.shutdown();
      }

      this.isInitialized = false;
      this.emit('shutdown');
      console.log('GeofencingOrchestrator shutdown complete');
    } catch (error) {
      console.error('Error during GeofencingOrchestrator shutdown:', error);
      this.emit('shutdownError', error);
    }
  }
}