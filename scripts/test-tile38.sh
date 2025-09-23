#!/bin/bash

# Smart Tourist Safety Monitoring System - Tile38 Testing Script
# This script tests Tile38 geofencing capabilities and performance

set -e

ENVIRONMENT=${NODE_ENV:-development}
CONTAINER_NAME="smart-tourist-tile38${ENVIRONMENT:+-prod}"

echo "Testing Tile38 geofencing capabilities..."

# Function to execute Tile38 commands
tile38_cmd() {
    docker exec $CONTAINER_NAME tile38-cli "$@"
}

# Test basic connectivity
echo "1. Testing basic connectivity..."
if tile38_cmd ping > /dev/null; then
    echo "✓ Tile38 is responding"
else
    echo "✗ Tile38 is not responding"
    exit 1
fi

# Test server info
echo ""
echo "2. Server information:"
tile38_cmd info

# Test geofencing setup
echo ""
echo "3. Testing geofencing setup..."

# Create a test collection
echo "Creating test collection 'tourists'..."
tile38_cmd flushdb
tile38_cmd set tourists user1 point 28.6129 77.2295  # New Delhi coordinates

# Create a test geofence zone (Red Fort area in Delhi)
echo "Creating test geofence zone..."
tile38_cmd sethook redfort http://localhost:3001/webhooks/geofence within tourists bounds 28.6560 77.2394 28.6580 77.2420

# Test point-in-polygon queries
echo ""
echo "4. Testing geospatial queries..."

# Set multiple test points
tile38_cmd set tourists user2 point 28.6570 77.2400  # Inside Red Fort area
tile38_cmd set tourists user3 point 28.5355 77.3910  # Outside (Noida)

# Test nearby query
echo "Finding tourists near Red Fort..."
tile38_cmd nearby tourists point 28.6570 77.2405 1000

# Test within query
echo "Finding tourists within Red Fort bounds..."
tile38_cmd within tourists bounds 28.6560 77.2394 28.6580 77.2420

# Performance test
echo ""
echo "5. Performance testing..."

# Bulk insert test
echo "Testing bulk location updates..."
start_time=$(date +%s%N)

for i in {1..1000}; do
    lat=$(echo "28.6 + ($i * 0.001)" | bc -l)
    lon=$(echo "77.2 + ($i * 0.001)" | bc -l)
    tile38_cmd set tourists "user$i" point $lat $lon > /dev/null
done

end_time=$(date +%s%N)
duration=$((($end_time - $start_time) / 1000000))  # Convert to milliseconds

echo "✓ Inserted 1000 points in ${duration}ms"
echo "✓ Average: $((duration / 1000))ms per insert"

# Query performance test
echo "Testing query performance..."
start_time=$(date +%s%N)

for i in {1..100}; do
    tile38_cmd nearby tourists point 28.6570 77.2405 1000 > /dev/null
done

end_time=$(date +%s%N)
query_duration=$((($end_time - $start_time) / 1000000))

echo "✓ Executed 100 nearby queries in ${query_duration}ms"
echo "✓ Average query time: $((query_duration / 100))ms"

# Test webhook functionality
echo ""
echo "6. Testing webhook configuration..."
tile38_cmd pdelhook redfort  # Delete previous hook
tile38_cmd sethook geofence_alerts http://localhost:3001/api/webhooks/geofence within tourists bounds 28.6560 77.2394 28.6580 77.2420

echo "✓ Webhook configured for geofence alerts"

# Memory usage
echo ""
echo "7. Memory usage:"
tile38_cmd info memory

# Collection stats
echo ""
echo "8. Collection statistics:"
tile38_cmd stats tourists

echo ""
echo "✓ All Tile38 tests completed successfully!"
echo ""
echo "Performance Summary:"
echo "- Bulk insert rate: ~$((1000000 / duration)) inserts/second"
echo "- Query response time: ~$((query_duration / 100))ms average"
echo ""
echo "Next steps:"
echo "1. Integrate with Node.js/TypeScript service wrapper"
echo "2. Implement production webhook endpoints"
echo "3. Set up monitoring and alerting"