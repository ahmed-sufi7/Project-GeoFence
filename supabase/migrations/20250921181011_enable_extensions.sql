-- Enable Required Extensions First
-- Migration: enable_extensions

-- Enable UUID extension (required for uuid_generate_v4())
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable PostGIS extension (required for geospatial data)
CREATE EXTENSION IF NOT EXISTS "postgis";

-- Enable additional useful extensions
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";