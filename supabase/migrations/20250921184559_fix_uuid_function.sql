-- Fix UUID function availability
-- Migration: fix_uuid_function

-- Ensure uuid-ossp extension is properly loaded
DROP EXTENSION IF EXISTS "uuid-ossp" CASCADE;
CREATE EXTENSION "uuid-ossp" SCHEMA public;

-- Ensure postgis extension is properly loaded
DROP EXTENSION IF EXISTS "postgis" CASCADE;
CREATE EXTENSION "postgis" SCHEMA public;

-- Test that uuid_generate_v4() works
SELECT uuid_generate_v4();