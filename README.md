# Smart Tourist Safety Monitoring System

A comprehensive real-time safety monitoring and geofencing system for tourists with mobile app, admin dashboard, and intelligent emergency response features.

## 🏗️ Architecture

This project uses a monorepo structure with the following packages:

- **`packages/mobile`** - React Native/Expo mobile application
- **`packages/admin`** - Next.js admin dashboard
- **`packages/backend`** - Node.js/Express backend services
- **`packages/shared`** - Shared types, utilities, and constants

## 🚀 Quick Start

### Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0
- Docker (for local development services)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd smart-tourist-safety-monitoring
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your actual API keys and configuration
```

4. Start development services (Redis, Tile38, PostgreSQL):
```bash
docker-compose up -d
```

### Development

Start all packages in development mode:
```bash
npm run dev
```

Or start individual packages:
```bash
npm run mobile:dev    # Start mobile app (Expo)
npm run admin:dev     # Start admin dashboard
npm run backend:dev   # Start backend services
```

### Building

Build all packages:
```bash
npm run build
```

Or build individual packages:
```bash
npm run mobile:build
npm run admin:build
npm run backend:build
```

## 📱 Features

### Mobile App (React Native/Expo)
- Real-time GPS tracking
- Geofencing alerts
- Emergency SOS button
- Offline P2P communication
- Tourist group management
- Safety zone notifications

### Admin Dashboard (Next.js)
- Real-time tourist location monitoring
- Geofence management
- Emergency alert dashboard
- Analytics and reporting
- Tourist group oversight
- Safety zone configuration

### Backend Services (Node.js)
- RESTful API
- Real-time WebSocket connections
- Geofencing with Tile38
- AI-powered behavior analysis
- Emergency response automation
- Notification services

## 🔧 Technology Stack

### Frontend
- **Mobile**: React Native, Expo SDK, React Navigation
- **Admin**: Next.js, React, Tailwind CSS, Leaflet Maps

### Backend
- **API**: Node.js, Express, TypeScript
- **Database**: Supabase (PostgreSQL)
- **Geofencing**: Tile38
- **Caching**: Redis
- **AI**: Google Gemini AI

### Development Tools
- **Monorepo**: npm workspaces
- **Type Safety**: TypeScript
- **Code Quality**: ESLint, Prettier, Husky
- **Testing**: Jest
- **Containerization**: Docker

## 🌍 Environment Configuration

Copy `.env.example` to `.env` and configure the following:

### Required
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anonymous key
- `GOOGLE_API_KEY` - Google Gemini AI API key

### Optional
- `TILE38_URL` - Tile38 server URL (default: redis://localhost:9851)
- `REDIS_URL` - Redis server URL (default: redis://localhost:6379)
- `SENDGRID_API_KEY` - SendGrid for email notifications
- Various other service API keys

## 📋 Available Scripts

### Root Level
- `npm run dev` - Start all packages in development mode
- `npm run build` - Build all packages
- `npm run test` - Run tests across all packages
- `npm run lint` - Lint all packages
- `npm run type-check` - TypeScript type checking

### Package Specific
- `npm run mobile:dev` - Start mobile app development server
- `npm run admin:dev` - Start admin dashboard development server
- `npm run backend:dev` - Start backend development server

## 🗂️ Project Structure

```
.
├── packages/
│   ├── mobile/          # React Native mobile app
│   │   ├── src/
│   │   ├── App.tsx
│   │   ├── app.json
│   │   └── package.json
│   ├── admin/           # Next.js admin dashboard
│   │   ├── src/
│   │   ├── next.config.js
│   │   └── package.json
│   ├── backend/         # Node.js backend
│   │   ├── src/
│   │   └── package.json
│   └── shared/          # Shared utilities
│       ├── src/
│       └── package.json
├── .env.example         # Environment variables template
├── docker-compose.yml   # Development services
├── package.json         # Root package configuration
└── README.md
```

## 🛡️ Security Features

- JWT-based authentication
- Encrypted P2P communication
- Secure API endpoints
- Environment variable protection
- Input validation and sanitization

## 🚨 Emergency Features

- One-tap SOS alerts
- Automatic emergency contact notification
- Real-time location sharing
- Offline emergency protocols
- Integration with local emergency services

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

For support and questions:
- Create an issue in the GitHub repository
- Contact the development team
- Check the documentation

---

**Note**: This is a development setup. For production deployment, additional security measures, environment configurations, and infrastructure considerations are required.