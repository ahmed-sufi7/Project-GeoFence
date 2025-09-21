#!/bin/bash

# Smart Tourist Safety Monitoring System - Development Setup Script

set -e

echo "🚀 Setting up Smart Tourist Safety Monitoring System..."

# Check Node.js version
echo "📋 Checking Node.js version..."
node_version=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$node_version" -lt 18 ]; then
    echo "❌ Node.js version 18 or higher is required. Current version: $(node -v)"
    exit 1
fi
echo "✅ Node.js version check passed: $(node -v)"

# Check npm version
echo "📋 Checking npm version..."
npm_version=$(npm -v | cut -d'.' -f1)
if [ "$npm_version" -lt 9 ]; then
    echo "❌ npm version 9 or higher is required. Current version: $(npm -v)"
    exit 1
fi
echo "✅ npm version check passed: $(npm -v)"

# Install dependencies
echo "📦 Installing dependencies..."
npm install --legacy-peer-deps

# Setup environment file
echo "⚙️ Setting up environment configuration..."
if [ ! -f .env ]; then
    cp .env.example .env
    echo "✅ Created .env file from template"
    echo "⚠️  Please edit .env file with your actual API keys and configuration"
else
    echo "ℹ️  .env file already exists"
fi

# Setup Git hooks
echo "🔧 Setting up Git hooks..."
npx husky install
echo "✅ Git hooks installed"

# Check Docker
echo "🐳 Checking Docker..."
if command -v docker &> /dev/null; then
    echo "✅ Docker is available"
    echo "🚀 Starting development services..."
    docker-compose up -d
    echo "✅ Development services started (Redis, Tile38, PostgreSQL)"
else
    echo "⚠️  Docker not found. Please install Docker to run development services."
    echo "   Services needed: Redis (port 6379), Tile38 (port 9851), PostgreSQL (port 5432)"
fi

# Build shared package
echo "🔨 Building shared package..."
npm run build --workspace=packages/shared

echo ""
echo "🎉 Setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Edit .env file with your API keys"
echo "2. Start development: npm run dev"
echo "3. Access applications:"
echo "   - Mobile app: expo start (in packages/mobile)"
echo "   - Admin dashboard: http://localhost:3000"
echo "   - Backend API: http://localhost:3001"
echo ""
echo "🔧 Available commands:"
echo "   npm run dev        - Start all services"
echo "   npm run mobile:dev - Start mobile app only"
echo "   npm run admin:dev  - Start admin dashboard only"
echo "   npm run backend:dev - Start backend only"
echo ""