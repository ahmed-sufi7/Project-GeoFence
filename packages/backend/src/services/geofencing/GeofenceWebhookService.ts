/**
 * Geofence Webhook Service
 *
 * Implements real-time zone entry/exit detection with webhook notifications,
 * retry mechanisms, and delivery reliability for the Smart Tourist Safety System.
 */

import { EventEmitter } from 'events';
import axios, { AxiosResponse } from 'axios';
import crypto from 'crypto';
import {
  Zone,
  GeofenceEvent,
  GeofenceEventType,
  WebhookConfig,
  WebhookPayload,
  LocationPoint,
  Coordinate,
  GeofencingError,
} from '../../types/geofencing';
import { ConnectionManager } from './ConnectionManager';
import { ZoneManagementService } from './ZoneManagementService';

export interface WebhookDeliveryResult {
  webhookId: string;
  url: string;
  success: boolean;
  statusCode?: number;
  responseTime: number;
  error?: string;
  retryCount: number;
}

export interface GeofenceDetectionConfig {
  enabled: boolean;
  checkInterval: number; // milliseconds
  batchSize: number;
  enableHistory: boolean;
  maxRetries: number;
  retryDelay: number;
  timeoutMs: number;
}

export class GeofenceWebhookService extends EventEmitter {
  private connectionManager: ConnectionManager;
  private zoneService: ZoneManagementService;
  private config: GeofenceDetectionConfig;
  private webhooks: Map<string, WebhookConfig> = new Map();
  private activeGeofences: Map<string, string> = new Map(); // hookId -> Tile38 hook ID
  private deliveryQueue: Array<{ event: GeofenceEvent; webhooks: WebhookConfig[] }> = [];
  private processingQueue = false;
  private detectionTimer: NodeJS.Timeout | null = null;
  private stats = {
    eventsDetected: 0,
    webhooksDelivered: 0,
    deliveryFailures: 0,
    averageDeliveryTime: 0,
  };

  constructor(
    connectionManager: ConnectionManager,
    zoneService: ZoneManagementService,
    config?: Partial<GeofenceDetectionConfig>
  ) {
    super();
    this.connectionManager = connectionManager;
    this.zoneService = zoneService;
    this.config = {
      enabled: true,
      checkInterval: 1000, // 1 second
      batchSize: 100,
      enableHistory: true,
      maxRetries: 3,
      retryDelay: 5000, // 5 seconds
      timeoutMs: 10000, // 10 seconds
      ...config,
    };

    this.startGeofenceDetection();
    this.startWebhookProcessor();
  }

  /**
   * Register a new webhook configuration
   */
  async registerWebhook(webhook: Omit<WebhookConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<WebhookConfig> {
    try {
      const webhookConfig: WebhookConfig = {
        ...webhook,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Validate webhook URL
      await this.validateWebhookUrl(webhookConfig.url);

      // Store webhook configuration
      this.webhooks.set(webhookConfig.id, webhookConfig);

      // Set up Tile38 geofence hooks for all applicable zones
      if (webhookConfig.enabled) {
        await this.setupGeofenceHooks(webhookConfig);
      }

      this.emit('webhookRegistered', webhookConfig);
      console.log(`Webhook registered: ${webhookConfig.id} -> ${webhookConfig.url}`);

      return webhookConfig;

    } catch (error) {
      console.error('Failed to register webhook:', error);
      throw new GeofencingError('Failed to register webhook', { originalError: error });
    }
  }

  /**
   * Update webhook configuration
   */
  async updateWebhook(webhookId: string, updates: Partial<WebhookConfig>): Promise<WebhookConfig> {
    try {
      const existingWebhook = this.webhooks.get(webhookId);
      if (!existingWebhook) {
        throw new GeofencingError(`Webhook not found: ${webhookId}`);
      }

      const updatedWebhook: WebhookConfig = {
        ...existingWebhook,
        ...updates,
        id: webhookId, // Ensure ID doesn't change
        updatedAt: new Date().toISOString(),
      };

      // Validate URL if changed
      if (updates.url && updates.url !== existingWebhook.url) {
        await this.validateWebhookUrl(updates.url);
      }

      // Update webhook configuration
      this.webhooks.set(webhookId, updatedWebhook);

      // Update Tile38 hooks if necessary
      if (updates.enabled !== undefined || updates.zoneIds || updates.zoneTypes || updates.eventTypes) {
        await this.removeGeofenceHooks(webhookId);
        if (updatedWebhook.enabled) {
          await this.setupGeofenceHooks(updatedWebhook);
        }
      }

      this.emit('webhookUpdated', updatedWebhook);
      return updatedWebhook;

    } catch (error) {
      console.error('Failed to update webhook:', error);
      throw new GeofencingError('Failed to update webhook', { originalError: error });
    }
  }

  /**
   * Remove webhook configuration
   */
  async removeWebhook(webhookId: string): Promise<boolean> {
    try {
      const webhook = this.webhooks.get(webhookId);
      if (!webhook) {
        return false;
      }

      // Remove Tile38 hooks
      await this.removeGeofenceHooks(webhookId);

      // Remove from configuration
      this.webhooks.delete(webhookId);

      this.emit('webhookRemoved', webhook);
      console.log(`Webhook removed: ${webhookId}`);

      return true;

    } catch (error) {
      console.error('Failed to remove webhook:', error);
      throw new GeofencingError('Failed to remove webhook', { originalError: error });
    }
  }

  /**
   * Get all registered webhooks
   */
  getWebhooks(): WebhookConfig[] {
    return Array.from(this.webhooks.values());
  }

  /**
   * Get webhook by ID
   */
  getWebhook(webhookId: string): WebhookConfig | null {
    return this.webhooks.get(webhookId) || null;
  }

  /**
   * Test webhook delivery
   */
  async testWebhook(webhookId: string): Promise<WebhookDeliveryResult> {
    try {
      const webhook = this.webhooks.get(webhookId);
      if (!webhook) {
        throw new GeofencingError(`Webhook not found: ${webhookId}`);
      }

      // Create test event
      const testEvent: GeofenceEvent = {
        id: `test-${Date.now()}`,
        userId: 'test-user',
        zoneId: 'test-zone',
        zoneName: 'Test Zone',
        zoneType: 'safe' as any,
        eventType: GeofenceEventType.ENTER,
        location: {
          userId: 'test-user',
          coordinates: { latitude: 28.6129, longitude: 77.2295 },
          timestamp: new Date().toISOString(),
        },
        timestamp: new Date().toISOString(),
        processed: false,
        metadata: {
          alertLevel: 'low',
        },
      };

      const payload: WebhookPayload = {
        event: testEvent,
        zone: {
          id: 'test-zone',
          name: 'Test Zone',
          type: 'safe' as any,
          status: 'active' as any,
          coordinates: [],
          boundingBox: { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 },
          geometry: { type: 'Polygon', coordinates: [[]] },
        },
        user: {
          id: 'test-user',
          name: 'Test User',
        },
        timestamp: new Date().toISOString(),
        signature: this.generateSignature(testEvent, webhook.secret),
      };

      return await this.deliverWebhook(webhook, payload, true);

    } catch (error) {
      console.error('Failed to test webhook:', error);
      throw new GeofencingError('Failed to test webhook', { originalError: error });
    }
  }

  /**
   * Process geofence event manually
   */
  async processGeofenceEvent(event: GeofenceEvent): Promise<void> {
    try {
      // Find applicable webhooks
      const applicableWebhooks = this.getApplicableWebhooks(event);

      if (applicableWebhooks.length > 0) {
        // Add to delivery queue
        this.deliveryQueue.push({ event, webhooks: applicableWebhooks });
        this.stats.eventsDetected++;

        this.emit('geofenceEventDetected', event);
      }

    } catch (error) {
      console.error('Failed to process geofence event:', error);
    }
  }

  /**
   * Get webhook delivery statistics
   */
  getWebhookStatistics(): {
    totalWebhooks: number;
    activeWebhooks: number;
    eventsDetected: number;
    webhooksDelivered: number;
    deliveryFailures: number;
    averageDeliveryTime: number;
    queueSize: number;
  } {
    const activeWebhooks = Array.from(this.webhooks.values()).filter(w => w.enabled).length;

    return {
      totalWebhooks: this.webhooks.size,
      activeWebhooks,
      eventsDetected: this.stats.eventsDetected,
      webhooksDelivered: this.stats.webhooksDelivered,
      deliveryFailures: this.stats.deliveryFailures,
      averageDeliveryTime: this.stats.averageDeliveryTime,
      queueSize: this.deliveryQueue.length,
    };
  }

  /**
   * Private methods
   */

  private startGeofenceDetection(): void {
    if (!this.config.enabled) return;

    this.detectionTimer = setInterval(async () => {
      try {
        await this.checkGeofenceEvents();
      } catch (error) {
        console.error('Geofence detection error:', error);
      }
    }, this.config.checkInterval);
  }

  private async checkGeofenceEvents(): Promise<void> {
    try {
      // Check for geofence events using Tile38's INTERSECTS command
      // This is a simplified implementation - in production you'd want more sophisticated event detection

      // Get all active zones
      const zones = await this.zoneService.getActiveZones(this.config.batchSize);

      for (const zone of zones) {
        // Check for users in this zone
        const usersInZone = await this.connectionManager.executeRead(async (service) => {
          const polygonCoords = zone.coordinates
            .map(coord => [coord.longitude, coord.latitude])
            .flat();

          return service.client.call(
            'WITHIN',
            'tourists',
            'POLYGON',
            ...polygonCoords
          );
        });

        // Process users found in zone
        if (usersInZone && Array.isArray(usersInZone) && usersInZone.length > 1) {
          await this.processZoneIntersections(zone, usersInZone[1]);
        }
      }

    } catch (error) {
      console.error('Failed to check geofence events:', error);
    }
  }

  private async processZoneIntersections(zone: Zone, users: any[]): Promise<void> {
    if (!Array.isArray(users)) return;

    for (let i = 0; i < users.length; i += 2) {
      const userId = users[i];
      const locationData = users[i + 1];

      if (userId && locationData) {
        // Create geofence event
        const event: GeofenceEvent = {
          id: `${zone.id}-${userId}-${Date.now()}`,
          userId,
          zoneId: zone.id,
          zoneName: zone.name,
          zoneType: zone.type,
          eventType: GeofenceEventType.INSIDE, // Simplified - you'd track enter/exit
          location: this.parseLocationFromTile38Data(userId, locationData),
          timestamp: new Date().toISOString(),
          processed: false,
          metadata: {
            alertLevel: this.calculateAlertLevel(zone),
          },
        };

        await this.processGeofenceEvent(event);
      }
    }
  }

  private parseLocationFromTile38Data(userId: string, data: any): LocationPoint {
    try {
      const geometry = JSON.parse(data);
      const coords = geometry.coordinates;

      return {
        userId,
        coordinates: {
          latitude: coords[1],
          longitude: coords[0],
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      // Fallback location
      return {
        userId,
        coordinates: { latitude: 0, longitude: 0 },
        timestamp: new Date().toISOString(),
      };
    }
  }

  private calculateAlertLevel(zone: Zone): 'low' | 'medium' | 'high' | 'critical' {
    const riskLevel = zone.metadata?.riskLevel || 5;

    if (riskLevel >= 9) return 'critical';
    if (riskLevel >= 7) return 'high';
    if (riskLevel >= 5) return 'medium';
    return 'low';
  }

  private startWebhookProcessor(): void {
    setInterval(async () => {
      if (!this.processingQueue && this.deliveryQueue.length > 0) {
        await this.processWebhookQueue();
      }
    }, 100); // Process every 100ms
  }

  private async processWebhookQueue(): Promise<void> {
    if (this.processingQueue || this.deliveryQueue.length === 0) return;

    this.processingQueue = true;

    try {
      const batchSize = Math.min(this.config.batchSize, this.deliveryQueue.length);
      const batch = this.deliveryQueue.splice(0, batchSize);

      const deliveryPromises = batch.map(({ event, webhooks }) =>
        this.deliverEventToWebhooks(event, webhooks)
      );

      await Promise.allSettled(deliveryPromises);

    } catch (error) {
      console.error('Webhook queue processing error:', error);
    } finally {
      this.processingQueue = false;
    }
  }

  private async deliverEventToWebhooks(event: GeofenceEvent, webhooks: WebhookConfig[]): Promise<void> {
    try {
      // Get zone and user data
      const zone = await this.zoneService.getZone(event.zoneId);
      if (!zone) return;

      const payload: WebhookPayload = {
        event,
        zone,
        user: {
          id: event.userId,
          // Add more user data here from your user service
        },
        timestamp: new Date().toISOString(),
      };

      // Deliver to all applicable webhooks
      const deliveryPromises = webhooks.map(webhook => {
        // Add signature if secret is provided
        if (webhook.secret) {
          payload.signature = this.generateSignature(event, webhook.secret);
        }

        return this.deliverWebhook(webhook, payload);
      });

      await Promise.allSettled(deliveryPromises);

    } catch (error) {
      console.error('Failed to deliver event to webhooks:', error);
    }
  }

  private async deliverWebhook(
    webhook: WebhookConfig,
    payload: WebhookPayload,
    isTest: boolean = false
  ): Promise<WebhookDeliveryResult> {
    const startTime = Date.now();
    let retryCount = 0;

    while (retryCount <= this.config.maxRetries) {
      try {
        const response: AxiosResponse = await axios.post(webhook.url, payload, {
          timeout: this.config.timeoutMs,
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Smart-Tourist-Safety-Webhook/1.0',
            ...webhook.headers,
          },
        });

        const responseTime = Date.now() - startTime;
        this.updateDeliveryStats(responseTime);

        const result: WebhookDeliveryResult = {
          webhookId: webhook.id,
          url: webhook.url,
          success: true,
          statusCode: response.status,
          responseTime,
          retryCount,
        };

        if (!isTest) {
          this.stats.webhooksDelivered++;
          this.emit('webhookDelivered', result);
        }

        return result;

      } catch (error: any) {
        retryCount++;
        const responseTime = Date.now() - startTime;

        if (retryCount <= this.config.maxRetries) {
          await this.delay(this.config.retryDelay * retryCount); // Exponential backoff
          continue;
        }

        // Max retries exceeded
        this.stats.deliveryFailures++;

        const result: WebhookDeliveryResult = {
          webhookId: webhook.id,
          url: webhook.url,
          success: false,
          statusCode: error.response?.status,
          responseTime,
          error: error.message,
          retryCount: retryCount - 1,
        };

        if (!isTest) {
          this.emit('webhookDeliveryFailed', result);
        }

        return result;
      }
    }

    // This should never be reached, but TypeScript requires it
    throw new Error('Unexpected webhook delivery state');
  }

  private getApplicableWebhooks(event: GeofenceEvent): WebhookConfig[] {
    return Array.from(this.webhooks.values()).filter(webhook => {
      if (!webhook.enabled) return false;

      // Check zone filters
      if (webhook.zoneIds && !webhook.zoneIds.includes(event.zoneId)) {
        return false;
      }

      if (webhook.zoneTypes && !webhook.zoneTypes.includes(event.zoneType)) {
        return false;
      }

      // Check event type filters
      if (!webhook.eventTypes.includes(event.eventType)) {
        return false;
      }

      return true;
    });
  }

  private async setupGeofenceHooks(webhook: WebhookConfig): Promise<void> {
    try {
      // Get applicable zones
      let zones: Zone[] = [];

      if (webhook.zoneIds) {
        // Get specific zones
        for (const zoneId of webhook.zoneIds) {
          const zone = await this.zoneService.getZone(zoneId);
          if (zone) zones.push(zone);
        }
      } else if (webhook.zoneTypes) {
        // Get zones by type
        for (const zoneType of webhook.zoneTypes) {
          const typeZones = await this.zoneService.getZonesByType(zoneType);
          zones.push(...typeZones);
        }
      } else {
        // Get all active zones
        zones = await this.zoneService.getActiveZones(1000);
      }

      // Set up Tile38 hooks for each zone
      for (const zone of zones) {
        const hookId = `${webhook.id}-${zone.id}`;

        await this.connectionManager.executeWrite(async (service) => {
          const polygonCoords = zone.coordinates
            .map(coord => [coord.longitude, coord.latitude])
            .flat();

          return service.client.call(
            'SETHOOK',
            hookId,
            `http://localhost:3001/api/geofence/webhook/${webhook.id}`, // Internal webhook endpoint
            'WITHIN',
            'tourists',
            'POLYGON',
            ...polygonCoords
          );
        });

        this.activeGeofences.set(hookId, hookId);
      }

    } catch (error) {
      console.error('Failed to setup geofence hooks:', error);
    }
  }

  private async removeGeofenceHooks(webhookId: string): Promise<void> {
    try {
      const hooksToRemove = Array.from(this.activeGeofences.keys())
        .filter(hookId => hookId.startsWith(`${webhookId}-`));

      for (const hookId of hooksToRemove) {
        await this.connectionManager.executeWrite(async (service) => {
          return service.client.call('PDELHOOK', hookId);
        });

        this.activeGeofences.delete(hookId);
      }

    } catch (error) {
      console.error('Failed to remove geofence hooks:', error);
    }
  }

  private async validateWebhookUrl(url: string): Promise<void> {
    try {
      const response = await axios.head(url, { timeout: 5000 });
      if (response.status >= 400) {
        throw new Error(`Webhook URL returned status ${response.status}`);
      }
    } catch (error) {
      throw new GeofencingError(`Invalid webhook URL: ${error.message}`);
    }
  }

  private generateSignature(event: GeofenceEvent, secret?: string): string {
    if (!secret) return '';

    const payload = JSON.stringify(event);
    return crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
  }

  private updateDeliveryStats(responseTime: number): void {
    const count = this.stats.webhooksDelivered + 1;
    this.stats.averageDeliveryTime =
      ((this.stats.averageDeliveryTime * this.stats.webhooksDelivered) + responseTime) / count;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    console.log('Shutting down Geofence Webhook Service...');

    if (this.detectionTimer) {
      clearInterval(this.detectionTimer);
      this.detectionTimer = null;
    }

    // Process remaining webhooks in queue
    while (this.deliveryQueue.length > 0 && !this.processingQueue) {
      await this.processWebhookQueue();
    }

    // Remove all Tile38 hooks
    for (const webhookId of this.webhooks.keys()) {
      await this.removeGeofenceHooks(webhookId);
    }

    this.emit('shutdown');
    console.log('Geofence Webhook Service shutdown complete');
  }

  /**
   * Get service health status
   */
  async getHealthStatus(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    activeWebhooks: number;
    queueSize: number;
    deliveryFailures: number;
    averageDeliveryTime: number;
  }> {
    const stats = this.getWebhookStatistics();
    const failureRate = stats.webhooksDelivered > 0 ?
      (stats.deliveryFailures / (stats.webhooksDelivered + stats.deliveryFailures)) * 100 : 0;

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (failureRate > 50 || stats.queueSize > 1000) {
      status = 'unhealthy';
    } else if (failureRate > 20 || stats.queueSize > 100) {
      status = 'degraded';
    }

    return {
      status,
      activeWebhooks: stats.activeWebhooks,
      queueSize: stats.queueSize,
      deliveryFailures: stats.deliveryFailures,
      averageDeliveryTime: stats.averageDeliveryTime,
    };
  }
}