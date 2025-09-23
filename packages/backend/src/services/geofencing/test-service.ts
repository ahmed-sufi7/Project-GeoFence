/**
 * Test Script for Tile38 Geofencing Service
 *
 * This script tests the basic functionality of the Tile38 service wrapper
 * to ensure proper connectivity and geofencing operations.
 */

import { createGeofencingService, LocationPoint, Zone, ZoneType, ZoneStatus } from './index';

async function testGeofencingService() {
  console.log('🚀 Testing Tile38 Geofencing Service...\n');

  try {
    // Create service instance
    const service = createGeofencingService();

    // Wait for service to be ready
    await new Promise<void>((resolve, reject) => {
      if (service.isReady()) {
        resolve();
        return;
      }

      service.once('ready', resolve);
      service.once('error', reject);

      // Timeout after 10 seconds
      setTimeout(() => reject(new Error('Service ready timeout')), 10000);
    });

    console.log('✅ Service connected successfully');

    // Test 1: Set location
    console.log('\n📍 Test 1: Setting user location...');
    const testLocation: LocationPoint = {
      userId: 'test-user-123',
      coordinates: {
        latitude: 28.6129, // New Delhi coordinates
        longitude: 77.2295,
      },
      timestamp: new Date().toISOString(),
      accuracy: 10,
    };

    await service.executeWrite(async (tile38) => {
      return tile38.setLocation(testLocation);
    });
    console.log('✅ Location set successfully');

    // Test 2: Get location
    console.log('\n📍 Test 2: Getting user location...');
    const retrievedLocation = await service.executeRead(async (tile38) => {
      return tile38.getLocation('test-user-123');
    });
    console.log('✅ Location retrieved:', retrievedLocation);

    // Test 3: Batch location updates
    console.log('\n📍 Test 3: Batch location updates...');
    const batchLocations: LocationPoint[] = [
      {
        userId: 'user-1',
        coordinates: { latitude: 28.6140, longitude: 77.2300 },
        timestamp: new Date().toISOString(),
      },
      {
        userId: 'user-2',
        coordinates: { latitude: 28.6150, longitude: 77.2310 },
        timestamp: new Date().toISOString(),
      },
      {
        userId: 'user-3',
        coordinates: { latitude: 28.6160, longitude: 77.2320 },
        timestamp: new Date().toISOString(),
      },
    ];

    await service.executeWrite(async (tile38) => {
      return tile38.setBatchLocations(batchLocations);
    });
    console.log('✅ Batch locations set successfully');

    // Test 4: Nearby query
    console.log('\n🔍 Test 4: Finding nearby users...');
    const nearbyResults = await service.executeRead(async (tile38) => {
      return tile38.findNearby({
        center: { latitude: 28.6129, longitude: 77.2295 },
        radius: 1000, // 1km radius
        limit: 10,
      });
    });
    console.log('✅ Nearby query results:', nearbyResults);

    // Test 5: Health check
    console.log('\n🏥 Test 5: Health check...');
    const healthStatus = await service.getOverallHealthStatus();
    console.log('✅ Health status:', {
      overall: healthStatus.overall,
      primaryConnected: healthStatus.primary.tile38.connected,
      totalConnections: healthStatus.summary.totalConnections,
      healthyConnections: healthStatus.summary.healthyConnections,
    });

    // Test 6: Connection pool statistics
    console.log('\n📊 Test 6: Connection pool statistics...');
    const poolStats = service.getPoolStatistics();
    console.log('✅ Pool statistics:', poolStats);

    console.log('\n🎉 All tests passed successfully!');

    // Cleanup
    await service.shutdown();
    console.log('✅ Service shutdown complete');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  testGeofencingService()
    .then(() => {
      console.log('\n✨ Test suite completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Test suite failed:', error);
      process.exit(1);
    });
}

export default testGeofencingService;