/**
 * Geofencing Services Exports
 *
 * Main entry point for all geofencing-related services and utilities
 * for the Smart Tourist Safety Monitoring System.
 */

export { Tile38Service } from './Tile38Service';
export { ConnectionManager } from './ConnectionManager';

// Re-export types and configuration
export * from '../../types/geofencing';
export { geofencingConfig, GeofencingConfig } from '../../config/geofencing';

// Service factory for easy instantiation
import { ConnectionManager } from './ConnectionManager';
import { GeofencingServiceConfig } from '../../types/geofencing';

/**
 * Factory function to create a configured geofencing service
 */
export function createGeofencingService(config?: Partial<GeofencingServiceConfig>): ConnectionManager {
  return new ConnectionManager(config);
}

/**
 * Default geofencing service instance (singleton)
 */
let defaultServiceInstance: ConnectionManager | null = null;

/**
 * Get the default geofencing service instance
 */
export function getGeofencingService(): ConnectionManager {
  if (!defaultServiceInstance) {
    defaultServiceInstance = new ConnectionManager();
  }
  return defaultServiceInstance;
}

/**
 * Shutdown the default geofencing service instance
 */
export async function shutdownGeofencingService(): Promise<void> {
  if (defaultServiceInstance) {
    await defaultServiceInstance.shutdown();
    defaultServiceInstance = null;
  }
}