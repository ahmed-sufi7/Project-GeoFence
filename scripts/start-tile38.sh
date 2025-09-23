#!/bin/bash

# Smart Tourist Safety Monitoring System - Tile38 Startup Script
# This script starts Tile38 with appropriate environment configuration

set -e

# Determine environment
ENVIRONMENT=${NODE_ENV:-development}

echo "Starting Tile38 for Smart Tourist Safety Monitoring System..."
echo "Environment: $ENVIRONMENT"

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "Error: Docker is not running. Please start Docker first."
    exit 1
fi

# Start appropriate services based on environment
if [ "$ENVIRONMENT" = "production" ]; then
    echo "Starting production Tile38 services..."
    docker-compose -f docker-compose.prod.yml up -d tile38 tile38-exporter

    # Wait for services to be healthy
    echo "Waiting for Tile38 to be ready..."
    timeout 60 bash -c 'until docker exec smart-tourist-tile38-prod tile38-cli ping > /dev/null 2>&1; do sleep 2; done'

    echo "Production Tile38 services started successfully!"
    echo "Tile38 is available at: localhost:9851"
    echo "Metrics available at: localhost:9090"

else
    echo "Starting development Tile38 services..."
    docker-compose up -d tile38 redis

    # Wait for services to be ready
    echo "Waiting for Tile38 to be ready..."
    timeout 60 bash -c 'until docker exec smart-tourist-tile38 tile38-cli ping > /dev/null 2>&1; do sleep 2; done'

    echo "Development Tile38 services started successfully!"
    echo "Tile38 is available at: localhost:9851"
    echo "Redis is available at: localhost:6379"
fi

# Display service status
echo ""
echo "Service Status:"
docker-compose ps

# Run basic health checks
echo ""
echo "Running health checks..."

# Test Tile38 connection
if docker exec smart-tourist-tile38${ENVIRONMENT:+-prod} tile38-cli ping > /dev/null 2>&1; then
    echo "✓ Tile38 is responding"
else
    echo "✗ Tile38 is not responding"
    exit 1
fi

# Test Redis connection (development only)
if [ "$ENVIRONMENT" != "production" ]; then
    if docker exec smart-tourist-redis redis-cli ping > /dev/null 2>&1; then
        echo "✓ Redis is responding"
    else
        echo "✗ Redis is not responding"
        exit 1
    fi
fi

echo ""
echo "All services are ready!"
echo ""
echo "Useful commands:"
echo "  View Tile38 logs: docker logs smart-tourist-tile38${ENVIRONMENT:+-prod}"
echo "  Connect to Tile38: docker exec -it smart-tourist-tile38${ENVIRONMENT:+-prod} tile38-cli"
if [ "$ENVIRONMENT" != "production" ]; then
    echo "  Connect to Redis: docker exec -it smart-tourist-redis redis-cli"
fi
echo "  Stop services: docker-compose down"