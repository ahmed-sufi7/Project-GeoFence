/**
 * Geospatial Validation Utilities
 *
 * This module provides comprehensive validation for geospatial data including
 * polygon validation, coordinate validation, and geometric calculations.
 */

import {
  Coordinate,
  Zone,
  ZoneValidationError,
  LocationValidationError,
  BoundingBox,
} from '../../../types/geofencing';

export class GeospatialValidator {
  /**
   * Validate a coordinate point
   */
  static validateCoordinate(coord: Coordinate): boolean {
    if (!coord || typeof coord.latitude !== 'number' || typeof coord.longitude !== 'number') {
      throw new LocationValidationError('Invalid coordinate format');
    }

    if (coord.latitude < -90 || coord.latitude > 90) {
      throw new LocationValidationError('Latitude must be between -90 and 90 degrees');
    }

    if (coord.longitude < -180 || coord.longitude > 180) {
      throw new LocationValidationError('Longitude must be between -180 and 180 degrees');
    }

    return true;
  }

  /**
   * Validate a polygon zone
   */
  static validateZonePolygon(zone: Zone): boolean {
    if (!zone.coordinates || !Array.isArray(zone.coordinates)) {
      throw new ZoneValidationError('Zone coordinates must be an array');
    }

    if (zone.coordinates.length < 3) {
      throw new ZoneValidationError('Polygon must have at least 3 coordinates');
    }

    if (zone.coordinates.length > 100) {
      throw new ZoneValidationError('Polygon cannot have more than 100 coordinates');
    }

    // Validate each coordinate
    zone.coordinates.forEach((coord, index) => {
      try {
        this.validateCoordinate(coord);
      } catch (error) {
        throw new ZoneValidationError(`Invalid coordinate at index ${index}: ${error.message}`);
      }
    });

    // Check if polygon is closed (first and last points should be the same or close)
    const firstPoint = zone.coordinates[0];
    const lastPoint = zone.coordinates[zone.coordinates.length - 1];
    const isClosedPolygon = this.calculateDistance(firstPoint, lastPoint) < 0.001; // 1 meter tolerance

    if (!isClosedPolygon) {
      // Auto-close the polygon if it's not closed
      zone.coordinates.push({ ...firstPoint });
    }

    // Validate polygon is not self-intersecting
    if (this.isSelfIntersecting(zone.coordinates)) {
      throw new ZoneValidationError('Polygon cannot be self-intersecting');
    }

    // Validate polygon area is reasonable
    const area = this.calculatePolygonArea(zone.coordinates);
    if (area < 100) { // Less than 100 square meters
      throw new ZoneValidationError('Zone area is too small (minimum 100 square meters)');
    }

    if (area > 1000000000) { // More than 1000 square kilometers
      throw new ZoneValidationError('Zone area is too large (maximum 1000 square kilometers)');
    }

    return true;
  }

  /**
   * Calculate the area of a polygon in square meters
   */
  static calculatePolygonArea(coordinates: Coordinate[]): number {
    if (coordinates.length < 3) return 0;

    let area = 0;
    const earthRadius = 6371000; // Earth's radius in meters

    for (let i = 0; i < coordinates.length - 1; i++) {
      const coord1 = coordinates[i];
      const coord2 = coordinates[i + 1];

      const lat1 = this.toRadians(coord1.latitude);
      const lat2 = this.toRadians(coord2.latitude);
      const lon1 = this.toRadians(coord1.longitude);
      const lon2 = this.toRadians(coord2.longitude);

      area += (lon2 - lon1) * (2 + Math.sin(lat1) + Math.sin(lat2));
    }

    area = Math.abs(area * earthRadius * earthRadius / 2);
    return area;
  }

  /**
   * Check if a polygon is self-intersecting
   */
  static isSelfIntersecting(coordinates: Coordinate[]): boolean {
    if (coordinates.length < 4) return false;

    for (let i = 0; i < coordinates.length - 1; i++) {
      for (let j = i + 2; j < coordinates.length - 1; j++) {
        // Skip adjacent edges
        if (Math.abs(i - j) <= 1 || (i === 0 && j === coordinates.length - 2)) {
          continue;
        }

        const line1 = {
          start: coordinates[i],
          end: coordinates[i + 1],
        };
        const line2 = {
          start: coordinates[j],
          end: coordinates[j + 1],
        };

        if (this.linesIntersect(line1, line2)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if two line segments intersect
   */
  static linesIntersect(
    line1: { start: Coordinate; end: Coordinate },
    line2: { start: Coordinate; end: Coordinate }
  ): boolean {
    const { start: p1, end: q1 } = line1;
    const { start: p2, end: q2 } = line2;

    const o1 = this.orientation(p1, q1, p2);
    const o2 = this.orientation(p1, q1, q2);
    const o3 = this.orientation(p2, q2, p1);
    const o4 = this.orientation(p2, q2, q1);

    // General case
    if (o1 !== o2 && o3 !== o4) {
      return true;
    }

    // Special cases for collinear points
    if (o1 === 0 && this.onSegment(p1, p2, q1)) return true;
    if (o2 === 0 && this.onSegment(p1, q2, q1)) return true;
    if (o3 === 0 && this.onSegment(p2, p1, q2)) return true;
    if (o4 === 0 && this.onSegment(p2, q1, q2)) return true;

    return false;
  }

  /**
   * Find orientation of ordered triplet (p, q, r)
   */
  static orientation(p: Coordinate, q: Coordinate, r: Coordinate): number {
    const val = (q.latitude - p.latitude) * (r.longitude - q.longitude) -
                (q.longitude - p.longitude) * (r.latitude - q.latitude);

    if (Math.abs(val) < 1e-10) return 0; // Collinear
    return val > 0 ? 1 : 2; // Clockwise or Counterclockwise
  }

  /**
   * Check if point q lies on line segment pr
   */
  static onSegment(p: Coordinate, q: Coordinate, r: Coordinate): boolean {
    return q.longitude <= Math.max(p.longitude, r.longitude) &&
           q.longitude >= Math.min(p.longitude, r.longitude) &&
           q.latitude <= Math.max(p.latitude, r.latitude) &&
           q.latitude >= Math.min(p.latitude, r.latitude);
  }

  /**
   * Calculate distance between two coordinates in meters
   */
  static calculateDistance(coord1: Coordinate, coord2: Coordinate): number {
    const R = 6371000; // Earth's radius in meters
    const lat1 = this.toRadians(coord1.latitude);
    const lat2 = this.toRadians(coord2.latitude);
    const deltaLat = this.toRadians(coord2.latitude - coord1.latitude);
    const deltaLon = this.toRadians(coord2.longitude - coord1.longitude);

    const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Calculate bounding box for a polygon
   */
  static calculateBoundingBox(coordinates: Coordinate[]): BoundingBox {
    if (coordinates.length === 0) {
      throw new ZoneValidationError('Cannot calculate bounding box for empty coordinates');
    }

    let minLat = coordinates[0].latitude;
    let maxLat = coordinates[0].latitude;
    let minLon = coordinates[0].longitude;
    let maxLon = coordinates[0].longitude;

    for (const coord of coordinates) {
      minLat = Math.min(minLat, coord.latitude);
      maxLat = Math.max(maxLat, coord.latitude);
      minLon = Math.min(minLon, coord.longitude);
      maxLon = Math.max(maxLon, coord.longitude);
    }

    return { minLat, maxLat, minLon, maxLon };
  }

  /**
   * Check if a point is inside a polygon
   */
  static isPointInPolygon(point: Coordinate, polygon: Coordinate[]): boolean {
    let inside = false;
    let j = polygon.length - 1;

    for (let i = 0; i < polygon.length; i++) {
      const xi = polygon[i].longitude;
      const yi = polygon[i].latitude;
      const xj = polygon[j].longitude;
      const yj = polygon[j].latitude;

      if (((yi > point.latitude) !== (yj > point.latitude)) &&
          (point.longitude < (xj - xi) * (point.latitude - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
      j = i;
    }

    return inside;
  }

  /**
   * Check if two polygons overlap
   */
  static polygonsOverlap(polygon1: Coordinate[], polygon2: Coordinate[]): boolean {
    // Check if any vertex of polygon1 is inside polygon2
    for (const point of polygon1) {
      if (this.isPointInPolygon(point, polygon2)) {
        return true;
      }
    }

    // Check if any vertex of polygon2 is inside polygon1
    for (const point of polygon2) {
      if (this.isPointInPolygon(point, polygon1)) {
        return true;
      }
    }

    // Check if any edges intersect
    for (let i = 0; i < polygon1.length - 1; i++) {
      for (let j = 0; j < polygon2.length - 1; j++) {
        const line1 = { start: polygon1[i], end: polygon1[i + 1] };
        const line2 = { start: polygon2[j], end: polygon2[j + 1] };

        if (this.linesIntersect(line1, line2)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Validate zone name
   */
  static validateZoneName(name: string): boolean {
    if (!name || typeof name !== 'string') {
      throw new ZoneValidationError('Zone name is required');
    }

    if (name.length < 3) {
      throw new ZoneValidationError('Zone name must be at least 3 characters');
    }

    if (name.length > 100) {
      throw new ZoneValidationError('Zone name cannot exceed 100 characters');
    }

    if (!/^[a-zA-Z0-9\s\-_]+$/.test(name)) {
      throw new ZoneValidationError('Zone name can only contain letters, numbers, spaces, hyphens, and underscores');
    }

    return true;
  }

  /**
   * Validate zone coordinates for 4-coordinate polygon requirement
   */
  static validateFourCoordinatePolygon(coordinates: Coordinate[]): boolean {
    if (coordinates.length !== 4 && coordinates.length !== 5) {
      throw new ZoneValidationError('Zone must have exactly 4 coordinates (plus optional closing coordinate)');
    }

    // If 5 coordinates, the last one should be the same as the first (closed polygon)
    if (coordinates.length === 5) {
      const first = coordinates[0];
      const last = coordinates[4];
      if (Math.abs(first.latitude - last.latitude) > 0.0001 ||
          Math.abs(first.longitude - last.longitude) > 0.0001) {
        throw new ZoneValidationError('Closing coordinate must match the first coordinate');
      }
    }

    return true;
  }

  /**
   * Convert degrees to radians
   */
  private static toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Convert radians to degrees
   */
  private static toDegrees(radians: number): number {
    return radians * (180 / Math.PI);
  }

  /**
   * Get the center point of a polygon
   */
  static getPolygonCenter(coordinates: Coordinate[]): Coordinate {
    if (coordinates.length === 0) {
      throw new ZoneValidationError('Cannot calculate center of empty polygon');
    }

    let totalLat = 0;
    let totalLon = 0;
    const validCoords = coordinates.slice(0, -1); // Remove last coordinate if it's the same as first

    for (const coord of validCoords) {
      totalLat += coord.latitude;
      totalLon += coord.longitude;
    }

    return {
      latitude: totalLat / validCoords.length,
      longitude: totalLon / validCoords.length,
    };
  }

  /**
   * Simplify polygon by removing redundant points
   */
  static simplifyPolygon(coordinates: Coordinate[], tolerance: number = 0.0001): Coordinate[] {
    if (coordinates.length <= 3) return coordinates;

    const simplified: Coordinate[] = [coordinates[0]];

    for (let i = 1; i < coordinates.length - 1; i++) {
      const prev = simplified[simplified.length - 1];
      const current = coordinates[i];
      const next = coordinates[i + 1];

      // Calculate if current point is necessary (not on the line between prev and next)
      const distance = this.pointToLineDistance(current, prev, next);
      if (distance > tolerance) {
        simplified.push(current);
      }
    }

    simplified.push(coordinates[coordinates.length - 1]);
    return simplified;
  }

  /**
   * Calculate distance from a point to a line segment
   */
  private static pointToLineDistance(point: Coordinate, lineStart: Coordinate, lineEnd: Coordinate): number {
    const A = point.longitude - lineStart.longitude;
    const B = point.latitude - lineStart.latitude;
    const C = lineEnd.longitude - lineStart.longitude;
    const D = lineEnd.latitude - lineStart.latitude;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;

    if (lenSq !== 0) {
      param = dot / lenSq;
    }

    let xx: number, yy: number;

    if (param < 0) {
      xx = lineStart.longitude;
      yy = lineStart.latitude;
    } else if (param > 1) {
      xx = lineEnd.longitude;
      yy = lineEnd.latitude;
    } else {
      xx = lineStart.longitude + param * C;
      yy = lineStart.latitude + param * D;
    }

    const dx = point.longitude - xx;
    const dy = point.latitude - yy;
    return Math.sqrt(dx * dx + dy * dy);
  }
}