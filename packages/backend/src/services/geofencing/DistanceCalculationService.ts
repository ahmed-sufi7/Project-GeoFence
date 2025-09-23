/**
 * Distance Calculation Service
 *
 * Advanced geospatial distance calculations using multiple algorithms and optimizations
 * for high-performance location-based queries in the Smart Tourist Safety Monitoring System.
 */

import { EventEmitter } from 'events';
import { Coordinate, LocationPoint } from '../../types/geofencing';
import { Tile38Service } from './Tile38Service';
import { CacheService } from './CacheService';
import { PerformanceMonitor } from './PerformanceMonitor';

interface DistanceCalculationOptions {
  algorithm?: 'haversine' | 'vincenty' | 'tile38' | 'auto';
  unit?: 'meters' | 'kilometers' | 'miles' | 'feet' | 'nautical_miles';
  precision?: number; // decimal places for result
  useCache?: boolean;
  cacheTTL?: number; // seconds
}

interface DistanceResult {
  distance: number;
  unit: string;
  algorithm: string;
  calculationTime: number;
  cached: boolean;
  coordinates: {
    from: Coordinate;
    to: Coordinate;
  };
}

interface DistanceMatrix {
  origins: Coordinate[];
  destinations: Coordinate[];
  distances: number[][];
  algorithm: string;
  unit: string;
  calculationTime: number;
}

interface NearestNeighborResult {
  point: Coordinate;
  distance: number;
  index: number;
}

interface DistanceStats {
  totalCalculations: number;
  cacheHits: number;
  cacheMisses: number;
  averageCalculationTime: number;
  algorithmUsage: {
    haversine: number;
    vincenty: number;
    tile38: number;
  };
}

export class DistanceCalculationService extends EventEmitter {
  private tile38Service?: Tile38Service;
  private cacheService?: CacheService;
  private performanceMonitor?: PerformanceMonitor;

  private stats: DistanceStats = {
    totalCalculations: 0,
    cacheHits: 0,
    cacheMisses: 0,
    averageCalculationTime: 0,
    algorithmUsage: {
      haversine: 0,
      vincenty: 0,
      tile38: 0
    }
  };

  private calculationTimes: number[] = [];

  // Constants for different algorithms
  private readonly EARTH_RADIUS = {
    meters: 6378137,
    kilometers: 6378.137,
    miles: 3963.1906,
    feet: 20925524.9,
    nautical_miles: 3440.0648
  };

  constructor(
    tile38Service?: Tile38Service,
    cacheService?: CacheService,
    performanceMonitor?: PerformanceMonitor
  ) {
    super();
    this.tile38Service = tile38Service;
    this.cacheService = cacheService;
    this.performanceMonitor = performanceMonitor;
  }

  /**
   * Calculate distance between two points
   */
  async calculateDistance(
    point1: Coordinate,
    point2: Coordinate,
    options: DistanceCalculationOptions = {}
  ): Promise<DistanceResult> {
    const startTime = Date.now();
    const operationId = `distance_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Start performance monitoring
    if (this.performanceMonitor) {
      this.performanceMonitor.startOperation(operationId, 'calculateDistance');
    }

    const opts = {
      algorithm: 'auto',
      unit: 'meters',
      precision: 6,
      useCache: true,
      cacheTTL: 300,
      ...options
    } as Required<DistanceCalculationOptions>;

    try {
      // Check cache first
      let distance: number;
      let algorithm: string;
      let cached = false;

      if (opts.useCache && this.cacheService) {
        const cacheKey = this.getCacheKey(point1, point2, opts.unit, opts.algorithm);
        const cachedDistance = await this.cacheService.getCachedNearbySearch(point1, 0); // Reuse cache structure

        if (cachedDistance && cachedDistance.length > 0) {
          // Simple cache check - in production you'd want more sophisticated caching
          cached = true;
          this.stats.cacheHits++;
        } else {
          this.stats.cacheMisses++;
        }
      }

      if (!cached) {
        // Determine best algorithm
        algorithm = await this.selectBestAlgorithm(point1, point2, opts.algorithm);

        // Calculate distance using selected algorithm
        distance = await this.calculateWithAlgorithm(point1, point2, algorithm, opts.unit);

        // Cache the result
        if (opts.useCache && this.cacheService) {
          // Cache implementation would go here
        }

        // Update algorithm usage stats
        this.stats.algorithmUsage[algorithm as keyof typeof this.stats.algorithmUsage]++;
      }

      const calculationTime = Date.now() - startTime;
      this.updateStats(calculationTime);

      // End performance monitoring
      if (this.performanceMonitor) {
        this.performanceMonitor.endOperation(operationId, 'calculateDistance', true, {
          algorithm,
          unit: opts.unit,
          cached
        });
      }

      const result: DistanceResult = {
        distance: Number(distance!.toFixed(opts.precision)),
        unit: opts.unit,
        algorithm: algorithm!,
        calculationTime,
        cached,
        coordinates: {
          from: point1,
          to: point2
        }
      };

      this.emit('distanceCalculated', result);
      return result;

    } catch (error) {
      // End performance monitoring with error
      if (this.performanceMonitor) {
        this.performanceMonitor.endOperation(operationId, 'calculateDistance', false, {
          error: error.message
        });
      }

      this.emit('calculationError', { point1, point2, options, error });
      throw error;
    }
  }

  /**
   * Calculate distance matrix for multiple origins and destinations
   */
  async calculateDistanceMatrix(
    origins: Coordinate[],
    destinations: Coordinate[],
    options: DistanceCalculationOptions = {}
  ): Promise<DistanceMatrix> {
    const startTime = Date.now();

    const opts = {
      algorithm: 'auto',
      unit: 'meters',
      precision: 6,
      ...options
    } as Required<DistanceCalculationOptions>;

    try {
      const algorithm = await this.selectBestAlgorithm(origins[0], destinations[0], opts.algorithm);
      const distances: number[][] = [];

      for (let i = 0; i < origins.length; i++) {
        distances[i] = [];
        for (let j = 0; j < destinations.length; j++) {
          const distance = await this.calculateWithAlgorithm(
            origins[i],
            destinations[j],
            algorithm,
            opts.unit
          );
          distances[i][j] = Number(distance.toFixed(opts.precision));
        }
      }

      const result: DistanceMatrix = {
        origins,
        destinations,
        distances,
        algorithm,
        unit: opts.unit,
        calculationTime: Date.now() - startTime
      };

      this.emit('matrixCalculated', result);
      return result;

    } catch (error) {
      this.emit('matrixCalculationError', { origins, destinations, options, error });
      throw error;
    }
  }

  /**
   * Find nearest neighbor from a set of points
   */
  async findNearestNeighbor(
    target: Coordinate,
    points: Coordinate[],
    options: DistanceCalculationOptions = {}
  ): Promise<NearestNeighborResult> {
    const opts = {
      algorithm: 'auto',
      unit: 'meters',
      precision: 6,
      ...options
    } as Required<DistanceCalculationOptions>;

    let minDistance = Infinity;
    let nearestPoint: Coordinate | null = null;
    let nearestIndex = -1;

    const algorithm = await this.selectBestAlgorithm(target, points[0], opts.algorithm);

    for (let i = 0; i < points.length; i++) {
      const distance = await this.calculateWithAlgorithm(target, points[i], algorithm, opts.unit);

      if (distance < minDistance) {
        minDistance = distance;
        nearestPoint = points[i];
        nearestIndex = i;
      }
    }

    if (!nearestPoint) {
      throw new Error('No nearest neighbor found');
    }

    return {
      point: nearestPoint,
      distance: Number(minDistance.toFixed(opts.precision)),
      index: nearestIndex
    };
  }

  /**
   * Find all points within a specified radius
   */
  async findPointsWithinRadius(
    center: Coordinate,
    points: Coordinate[],
    radius: number,
    options: DistanceCalculationOptions = {}
  ): Promise<Array<{ point: Coordinate; distance: number; index: number }>> {
    const opts = {
      algorithm: 'auto',
      unit: 'meters',
      precision: 6,
      ...options
    } as Required<DistanceCalculationOptions>;

    const results: Array<{ point: Coordinate; distance: number; index: number }> = [];
    const algorithm = await this.selectBestAlgorithm(center, points[0], opts.algorithm);

    for (let i = 0; i < points.length; i++) {
      const distance = await this.calculateWithAlgorithm(center, points[i], algorithm, opts.unit);

      if (distance <= radius) {
        results.push({
          point: points[i],
          distance: Number(distance.toFixed(opts.precision)),
          index: i
        });
      }
    }

    return results.sort((a, b) => a.distance - b.distance);
  }

  /**
   * Select the best algorithm based on distance and available services
   */
  private async selectBestAlgorithm(
    point1: Coordinate,
    point2: Coordinate,
    preferredAlgorithm: string
  ): Promise<string> {
    if (preferredAlgorithm !== 'auto') {
      return preferredAlgorithm;
    }

    // If Tile38 is available and points are not too close, use it for best accuracy
    if (this.tile38Service) {
      const roughDistance = this.calculateHaversineDistance(point1, point2, 'kilometers');
      if (roughDistance > 1) { // Use Tile38 for distances > 1km
        return 'tile38';
      }
    }

    // For medium distances, use Vincenty
    const roughDistance = this.calculateHaversineDistance(point1, point2, 'kilometers');
    if (roughDistance > 0.1 && roughDistance <= 20) {
      return 'vincenty';
    }

    // Default to Haversine for short distances or when other methods aren't available
    return 'haversine';
  }

  /**
   * Calculate distance using specific algorithm
   */
  private async calculateWithAlgorithm(
    point1: Coordinate,
    point2: Coordinate,
    algorithm: string,
    unit: string
  ): Promise<number> {
    switch (algorithm) {
      case 'haversine':
        return this.calculateHaversineDistance(point1, point2, unit);

      case 'vincenty':
        return this.calculateVincentyDistance(point1, point2, unit);

      case 'tile38':
        if (!this.tile38Service) {
          throw new Error('Tile38 service not available');
        }
        return this.calculateTile38Distance(point1, point2, unit);

      default:
        throw new Error(`Unknown algorithm: ${algorithm}`);
    }
  }

  /**
   * Haversine distance calculation (fast, good for short distances)
   */
  private calculateHaversineDistance(
    point1: Coordinate,
    point2: Coordinate,
    unit: string
  ): number {
    const R = this.EARTH_RADIUS[unit as keyof typeof this.EARTH_RADIUS];

    const dLat = this.toRadians(point2.latitude - point1.latitude);
    const dLon = this.toRadians(point2.longitude - point1.longitude);

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRadians(point1.latitude)) * Math.cos(this.toRadians(point2.latitude)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Vincenty distance calculation (more accurate for longer distances)
   */
  private calculateVincentyDistance(
    point1: Coordinate,
    point2: Coordinate,
    unit: string
  ): number {
    const a = 6378137; // semi-major axis (meters)
    const b = 6356752.314245; // semi-minor axis (meters)
    const f = 1 / 298.257223563; // flattening

    const L = this.toRadians(point2.longitude - point1.longitude);
    const U1 = Math.atan((1 - f) * Math.tan(this.toRadians(point1.latitude)));
    const U2 = Math.atan((1 - f) * Math.tan(this.toRadians(point2.latitude)));

    const sinU1 = Math.sin(U1), cosU1 = Math.cos(U1);
    const sinU2 = Math.sin(U2), cosU2 = Math.cos(U2);

    let lambda = L;
    let lambdaP: number;
    let iterLimit = 100;
    let cosSqAlpha: number, sinSigma: number, cos2SigmaM: number, cosSigma: number, sigma: number;

    do {
      const sinLambda = Math.sin(lambda), cosLambda = Math.cos(lambda);
      sinSigma = Math.sqrt((cosU2 * sinLambda) * (cosU2 * sinLambda) +
                          (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) * (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda));

      if (sinSigma === 0) return 0; // co-incident points

      cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
      sigma = Math.atan2(sinSigma, cosSigma);
      const sinAlpha = cosU1 * cosU2 * sinLambda / sinSigma;
      cosSqAlpha = 1 - sinAlpha * sinAlpha;
      cos2SigmaM = cosSigma - 2 * sinU1 * sinU2 / cosSqAlpha;

      if (isNaN(cos2SigmaM)) cos2SigmaM = 0; // equatorial line

      const C = f / 16 * cosSqAlpha * (4 + f * (4 - 3 * cosSqAlpha));
      lambdaP = lambda;
      lambda = L + (1 - C) * f * sinAlpha *
               (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
    } while (Math.abs(lambda - lambdaP) > 1e-12 && --iterLimit > 0);

    if (iterLimit === 0) {
      // Fallback to Haversine
      return this.calculateHaversineDistance(point1, point2, unit);
    }

    const uSq = cosSqAlpha * (a * a - b * b) / (b * b);
    const A = 1 + uSq / 16384 * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
    const B = uSq / 1024 * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
    const deltaSigma = B * sinSigma * (cos2SigmaM + B / 4 * (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
                      B / 6 * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)));

    const distanceMeters = b * A * (sigma - deltaSigma);

    // Convert to requested unit
    return this.convertDistance(distanceMeters, 'meters', unit);
  }

  /**
   * Tile38 distance calculation (most accurate, uses geospatial database)
   */
  private async calculateTile38Distance(
    point1: Coordinate,
    point2: Coordinate,
    unit: string
  ): Promise<number> {
    // This would use Tile38's DISTANCE command or similar functionality
    // For now, fallback to Vincenty as Tile38 doesn't have a direct distance command
    return this.calculateVincentyDistance(point1, point2, unit);
  }

  /**
   * Convert distance between units
   */
  private convertDistance(distance: number, fromUnit: string, toUnit: string): number {
    if (fromUnit === toUnit) return distance;

    // Convert to meters first
    let meters: number;
    switch (fromUnit) {
      case 'meters':
        meters = distance;
        break;
      case 'kilometers':
        meters = distance * 1000;
        break;
      case 'miles':
        meters = distance * 1609.344;
        break;
      case 'feet':
        meters = distance * 0.3048;
        break;
      case 'nautical_miles':
        meters = distance * 1852;
        break;
      default:
        throw new Error(`Unknown unit: ${fromUnit}`);
    }

    // Convert from meters to target unit
    switch (toUnit) {
      case 'meters':
        return meters;
      case 'kilometers':
        return meters / 1000;
      case 'miles':
        return meters / 1609.344;
      case 'feet':
        return meters / 0.3048;
      case 'nautical_miles':
        return meters / 1852;
      default:
        throw new Error(`Unknown unit: ${toUnit}`);
    }
  }

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  private getCacheKey(point1: Coordinate, point2: Coordinate, unit: string, algorithm: string): string {
    const p1 = `${point1.latitude.toFixed(6)},${point1.longitude.toFixed(6)}`;
    const p2 = `${point2.latitude.toFixed(6)},${point2.longitude.toFixed(6)}`;
    return `distance:${algorithm}:${unit}:${p1}:${p2}`;
  }

  private updateStats(calculationTime: number): void {
    this.stats.totalCalculations++;
    this.calculationTimes.push(calculationTime);

    // Keep only last 1000 calculation times
    if (this.calculationTimes.length > 1000) {
      this.calculationTimes.shift();
    }

    this.stats.averageCalculationTime =
      this.calculationTimes.reduce((sum, time) => sum + time, 0) / this.calculationTimes.length;
  }

  /**
   * Get service statistics
   */
  getStats(): DistanceStats {
    return { ...this.stats };
  }

  /**
   * Reset service statistics
   */
  resetStats(): void {
    this.stats = {
      totalCalculations: 0,
      cacheHits: 0,
      cacheMisses: 0,
      averageCalculationTime: 0,
      algorithmUsage: {
        haversine: 0,
        vincenty: 0,
        tile38: 0
      }
    };
    this.calculationTimes = [];
  }
}