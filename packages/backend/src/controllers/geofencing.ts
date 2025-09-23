/**
 * Geofencing API Controller
 *
 * High-performance REST API endpoints for geofencing operations including
 * location tracking, zone management, and bulk processing.
 */

import { Request, Response, NextFunction } from 'express';
import { GeofencingOrchestrator } from '../services/geofencing/GeofencingOrchestrator';
import {
  LocationPoint,
  Zone,
  BulkLocationUpdate,
  NearbyQuery,
  WithinQuery,
  GeofenceEvent,
  Coordinate
} from '../types/geofencing';

export class GeofencingController {
  private orchestrator: GeofencingOrchestrator;

  constructor(orchestrator: GeofencingOrchestrator) {
    this.orchestrator = orchestrator;

    // Bind methods to preserve 'this' context
    this.updateLocation = this.updateLocation.bind(this);
    this.bulkUpdateLocations = this.bulkUpdateLocations.bind(this);
    this.queueLocationUpdate = this.queueLocationUpdate.bind(this);
    this.getUserLocation = this.getUserLocation.bind(this);
    this.findNearbyUsers = this.findNearbyUsers.bind(this);
    this.findUsersInZone = this.findUsersInZone.bind(this);
    this.createZone = this.createZone.bind(this);
    this.deleteZone = this.deleteZone.bind(this);
    this.getProcessingStats = this.getProcessingStats.bind(this);
    this.getPerformanceMetrics = this.getPerformanceMetrics.bind(this);
    this.getCacheStats = this.getCacheStats.bind(this);
    this.getHealthStatus = this.getHealthStatus.bind(this);
    this.calculateDistance = this.calculateDistance.bind(this);
    this.calculateDistanceMatrix = this.calculateDistanceMatrix.bind(this);
    this.findNearestPoint = this.findNearestPoint.bind(this);
    this.getUserLocationHistory = this.getUserLocationHistory.bind(this);
    this.syncZonesFromSupabase = this.syncZonesFromSupabase.bind(this);
    this.getSupabaseSyncStats = this.getSupabaseSyncStats.bind(this);
    this.getDistanceStats = this.getDistanceStats.bind(this);
  }

  /**
   * Update a single user location
   * POST /api/geofencing/location
   */
  async updateLocation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const location: LocationPoint = req.body;

      // Validate required fields
      if (!location.userId || !location.coordinates) {
        res.status(400).json({
          error: 'Missing required fields: userId and coordinates are required'
        });
        return;
      }

      // Validate coordinates
      const { latitude, longitude } = location.coordinates;
      if (typeof latitude !== 'number' || typeof longitude !== 'number') {
        res.status(400).json({
          error: 'Coordinates must be numeric values'
        });
        return;
      }

      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        res.status(400).json({
          error: 'Invalid coordinates: latitude must be -90 to 90, longitude must be -180 to 180'
        });
        return;
      }

      // Add timestamp if not provided
      if (!location.timestamp) {
        location.timestamp = new Date().toISOString();
      }

      await this.orchestrator.updateLocation(location);

      res.status(200).json({
        success: true,
        message: 'Location updated successfully',
        userId: location.userId,
        timestamp: location.timestamp
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Process bulk location updates
   * POST /api/geofencing/locations/bulk
   */
  async bulkUpdateLocations(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const updates: BulkLocationUpdate[] = req.body;

      if (!Array.isArray(updates) || updates.length === 0) {
        res.status(400).json({
          error: 'Request body must be a non-empty array of bulk location updates'
        });
        return;
      }

      // Validate each update
      for (const update of updates) {
        if (!update.locations || !Array.isArray(update.locations)) {
          res.status(400).json({
            error: 'Each update must have a locations array'
          });
          return;
        }

        for (const location of update.locations) {
          if (!location.userId || !location.coordinates) {
            res.status(400).json({
              error: 'Each location must have userId and coordinates'
            });
            return;
          }
        }
      }

      await this.orchestrator.processBulkLocations(updates);

      res.status(200).json({
        success: true,
        message: 'Bulk location updates processed successfully',
        updatesCount: updates.length,
        totalLocations: updates.reduce((sum, update) => sum + update.locations.length, 0)
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Queue a location update for background processing
   * POST /api/geofencing/location/queue
   */
  async queueLocationUpdate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const location: LocationPoint = req.body;

      // Basic validation
      if (!location.userId || !location.coordinates) {
        res.status(400).json({
          error: 'Missing required fields: userId and coordinates are required'
        });
        return;
      }

      if (!location.timestamp) {
        location.timestamp = new Date().toISOString();
      }

      await this.orchestrator.queueLocationUpdate(location);

      res.status(202).json({
        success: true,
        message: 'Location update queued for processing',
        userId: location.userId
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get user's current location
   * GET /api/geofencing/location/:userId
   */
  async getUserLocation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userId } = req.params;

      if (!userId) {
        res.status(400).json({
          error: 'userId parameter is required'
        });
        return;
      }

      const location = await this.orchestrator.getUserLocation(userId);

      if (!location) {
        res.status(404).json({
          error: 'Location not found for user',
          userId
        });
        return;
      }

      res.status(200).json({
        success: true,
        location
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Find nearby users
   * POST /api/geofencing/nearby
   */
  async findNearbyUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query: NearbyQuery = req.body;

      // Validate query
      if (!query.center || !query.center.latitude || !query.center.longitude || !query.radius) {
        res.status(400).json({
          error: 'Query must include center coordinates and radius'
        });
        return;
      }

      if (query.radius <= 0 || query.radius > 100000) { // Max 100km radius
        res.status(400).json({
          error: 'Radius must be between 1 and 100,000 meters'
        });
        return;
      }

      const users = await this.orchestrator.findNearbyUsers(query);

      res.status(200).json({
        success: true,
        query,
        count: users.length,
        users
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Find users within a specific zone
   * POST /api/geofencing/within
   */
  async findUsersInZone(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query: WithinQuery = req.body;

      // Validate query
      if (!query.bounds) {
        res.status(400).json({
          error: 'Query must include bounds (bounding box or coordinate array)'
        });
        return;
      }

      const users = await this.orchestrator.findUsersInZone(query);

      res.status(200).json({
        success: true,
        query,
        count: users.length,
        users
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create a new geofence zone
   * POST /api/geofencing/zones
   */
  async createZone(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const zone: Zone = req.body;

      // Validate required fields
      if (!zone.id || !zone.name || !zone.coordinates) {
        res.status(400).json({
          error: 'Zone must include id, name, and coordinates'
        });
        return;
      }

      // Validate coordinates (must be at least 3 points for a polygon)
      if (!Array.isArray(zone.coordinates) || zone.coordinates.length < 3) {
        res.status(400).json({
          error: 'Zone must have at least 3 coordinate points'
        });
        return;
      }

      // Add timestamps if not provided
      const now = new Date().toISOString();
      if (!zone.metadata?.createdAt) {
        zone.metadata = { ...zone.metadata, createdAt: now };
      }
      if (!zone.metadata?.updatedAt) {
        zone.metadata = { ...zone.metadata, updatedAt: now };
      }

      await this.orchestrator.createZone(zone);

      res.status(201).json({
        success: true,
        message: 'Zone created successfully',
        zoneId: zone.id,
        zoneName: zone.name
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete a geofence zone
   * DELETE /api/geofencing/zones/:zoneId
   */
  async deleteZone(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { zoneId } = req.params;

      if (!zoneId) {
        res.status(400).json({
          error: 'zoneId parameter is required'
        });
        return;
      }

      await this.orchestrator.deleteZone(zoneId);

      res.status(200).json({
        success: true,
        message: 'Zone deleted successfully',
        zoneId
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get bulk processing statistics
   * GET /api/geofencing/stats/processing
   */
  async getProcessingStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const stats = this.orchestrator.getProcessingStats();

      res.status(200).json({
        success: true,
        stats,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get performance metrics
   * GET /api/geofencing/stats/performance
   */
  async getPerformanceMetrics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const metrics = this.orchestrator.getPerformanceSummary();

      res.status(200).json({
        success: true,
        metrics,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get cache statistics
   * GET /api/geofencing/stats/cache
   */
  async getCacheStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const cacheStats = this.orchestrator.getCacheStats();

      res.status(200).json({
        success: true,
        cacheStats,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get comprehensive health status
   * GET /api/geofencing/health
   */
  async getHealthStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const health = await this.orchestrator.getHealthStatus();

      const statusCode = health.status === 'healthy' ? 200 : 503;

      res.status(statusCode).json({
        success: health.status === 'healthy',
        health
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Calculate distance between two points
   * POST /api/geofencing/distance
   */
  async calculateDistance(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { point1, point2, options } = req.body;

      // Validate input
      if (!point1 || !point2) {
        res.status(400).json({
          error: 'Both point1 and point2 are required'
        });
        return;
      }

      if (!point1.latitude || !point1.longitude || !point2.latitude || !point2.longitude) {
        res.status(400).json({
          error: 'Both points must have latitude and longitude'
        });
        return;
      }

      const result = await this.orchestrator.calculateDistance(point1, point2, options);

      res.status(200).json({
        success: true,
        result
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Calculate distance matrix for multiple points
   * POST /api/geofencing/distance/matrix
   */
  async calculateDistanceMatrix(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { origins, destinations, options } = req.body;

      // Validate input
      if (!Array.isArray(origins) || !Array.isArray(destinations)) {
        res.status(400).json({
          error: 'Both origins and destinations must be arrays'
        });
        return;
      }

      if (origins.length === 0 || destinations.length === 0) {
        res.status(400).json({
          error: 'Origins and destinations arrays cannot be empty'
        });
        return;
      }

      const result = await this.orchestrator.calculateDistanceMatrix(origins, destinations, options);

      res.status(200).json({
        success: true,
        result
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Find nearest point to a target location
   * POST /api/geofencing/nearest
   */
  async findNearestPoint(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { target, points, options } = req.body;

      // Validate input
      if (!target || !Array.isArray(points)) {
        res.status(400).json({
          error: 'Target point and points array are required'
        });
        return;
      }

      if (points.length === 0) {
        res.status(400).json({
          error: 'Points array cannot be empty'
        });
        return;
      }

      const result = await this.orchestrator.findNearestPoint(target, points, options);

      res.status(200).json({
        success: true,
        result
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get user location history from Supabase
   * GET /api/geofencing/location/:userId/history
   */
  async getUserLocationHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userId } = req.params;
      const { startTime, endTime, limit } = req.query;

      if (!userId) {
        res.status(400).json({
          error: 'userId parameter is required'
        });
        return;
      }

      const history = await this.orchestrator.getUserLocationHistory(
        userId,
        startTime as string,
        endTime as string,
        limit ? parseInt(limit as string) : undefined
      );

      res.status(200).json({
        success: true,
        userId,
        count: history.length,
        history
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Sync zones from Supabase to Tile38
   * POST /api/geofencing/zones/sync
   */
  async syncZonesFromSupabase(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const zones = await this.orchestrator.syncZonesFromSupabase();

      res.status(200).json({
        success: true,
        message: 'Zones synchronized successfully',
        count: zones.length,
        zones: zones.map(zone => ({
          id: zone.id,
          name: zone.name,
          type: zone.type,
          status: zone.status
        }))
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get Supabase synchronization statistics
   * GET /api/geofencing/stats/supabase
   */
  async getSupabaseSyncStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const stats = this.orchestrator.getSupabaseSyncStats();

      res.status(200).json({
        success: true,
        stats,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get distance calculation statistics
   * GET /api/geofencing/stats/distance
   */
  async getDistanceStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const stats = this.orchestrator.getDistanceStats();

      res.status(200).json({
        success: true,
        stats,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      next(error);
    }
  }
}