-- Create Geospatial Tables for Location Tracking
-- Migration: create_geospatial_tables

-- Ensure PostGIS extension is enabled (should already be from previous migration)
CREATE EXTENSION IF NOT EXISTS "postgis";

-- Create Zones table with 4-coordinate polygon boundaries and zone types
CREATE TABLE zones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    zone_name VARCHAR(100) NOT NULL,
    zone_type VARCHAR(50) NOT NULL CHECK (zone_type IN ('safe', 'caution', 'danger', 'restricted', 'tourist_area', 'emergency_service', 'hospital', 'police_station')),
    description TEXT,
    -- Geospatial data - using PostGIS geometry types
    boundaries GEOMETRY(POLYGON, 4326) NOT NULL, -- WGS84 coordinate system
    center_point GEOMETRY(POINT, 4326),
    -- Zone metadata
    risk_level INTEGER DEFAULT 1 CHECK (risk_level BETWEEN 1 AND 10),
    is_active BOOLEAN DEFAULT true,
    -- Administrative information
    country VARCHAR(100),
    state_province VARCHAR(100),
    city VARCHAR(100),
    -- Contact information for zone authorities
    authority_contact VARCHAR(255),
    emergency_number VARCHAR(20),
    -- Zone timing and validity
    valid_from TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    valid_until TIMESTAMP WITH TIME ZONE,
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id)
);

-- Create Location Logs table for GPS tracking with accuracy metrics
CREATE TABLE location_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Geospatial data
    location GEOMETRY(POINT, 4326) NOT NULL, -- GPS coordinates
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    altitude DECIMAL(8, 2), -- meters above sea level
    -- GPS accuracy and quality metrics
    accuracy_meters DECIMAL(6, 2), -- GPS accuracy in meters
    speed_kmh DECIMAL(5, 2), -- Speed in km/h
    heading_degrees INTEGER CHECK (heading_degrees BETWEEN 0 AND 359), -- Direction of travel
    -- Device and context information
    device_id VARCHAR(100),
    battery_level INTEGER CHECK (battery_level BETWEEN 0 AND 100),
    network_type VARCHAR(20) CHECK (network_type IN ('wifi', '4g', '5g', '3g', 'offline')),
    -- Location context
    is_moving BOOLEAN DEFAULT false,
    is_indoor BOOLEAN DEFAULT false,
    current_zone_id UUID REFERENCES zones(id),
    -- Timestamp information
    recorded_at TIMESTAMP WITH TIME ZONE NOT NULL,
    received_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Privacy and consent
    is_anonymous BOOLEAN DEFAULT false,
    sharing_enabled BOOLEAN DEFAULT true,
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create Zone Visits table to track user visits to specific zones
CREATE TABLE zone_visits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    zone_id UUID NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
    -- Visit timing
    entered_at TIMESTAMP WITH TIME ZONE NOT NULL,
    exited_at TIMESTAMP WITH TIME ZONE,
    duration_minutes INTEGER,
    -- Visit context
    entry_location GEOMETRY(POINT, 4326),
    exit_location GEOMETRY(POINT, 4326),
    visit_purpose VARCHAR(100),
    -- Risk assessment during visit
    average_risk_score DECIMAL(3, 2),
    max_risk_score DECIMAL(3, 2),
    incidents_during_visit INTEGER DEFAULT 0,
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create spatial indexes for efficient geospatial queries
CREATE INDEX idx_zones_boundaries ON zones USING GIST (boundaries);
CREATE INDEX idx_zones_center_point ON zones USING GIST (center_point);
CREATE INDEX idx_zones_type ON zones(zone_type);
CREATE INDEX idx_zones_risk_level ON zones(risk_level);
CREATE INDEX idx_zones_country_city ON zones(country, city);
CREATE INDEX idx_zones_is_active ON zones(is_active);

CREATE INDEX idx_location_logs_location ON location_logs USING GIST (location);
CREATE INDEX idx_location_logs_user_id ON location_logs(user_id);
CREATE INDEX idx_location_logs_recorded_at ON location_logs(recorded_at);
CREATE INDEX idx_location_logs_current_zone ON location_logs(current_zone_id);
CREATE INDEX idx_location_logs_user_time ON location_logs(user_id, recorded_at);
CREATE INDEX idx_location_logs_accuracy ON location_logs(accuracy_meters);
CREATE INDEX idx_location_logs_sharing ON location_logs(sharing_enabled);

CREATE INDEX idx_zone_visits_user_id ON zone_visits(user_id);
CREATE INDEX idx_zone_visits_zone_id ON zone_visits(zone_id);
CREATE INDEX idx_zone_visits_entered_at ON zone_visits(entered_at);
CREATE INDEX idx_zone_visits_user_zone ON zone_visits(user_id, zone_id);
CREATE INDEX idx_zone_visits_duration ON zone_visits(duration_minutes);

-- Create trigger function for calculating zone visit duration
CREATE OR REPLACE FUNCTION calculate_zone_visit_duration()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.exited_at IS NOT NULL AND NEW.entered_at IS NOT NULL THEN
        NEW.duration_minutes = EXTRACT(EPOCH FROM (NEW.exited_at - NEW.entered_at)) / 60;
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for automatic duration calculation
CREATE TRIGGER calculate_zone_visit_duration_trigger
    BEFORE INSERT OR UPDATE ON zone_visits
    FOR EACH ROW
    EXECUTE FUNCTION calculate_zone_visit_duration();

-- Create trigger for updated_at timestamp on zones
CREATE TRIGGER update_zones_updated_at
    BEFORE UPDATE ON zones
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create trigger for updated_at timestamp on zone_visits
CREATE TRIGGER update_zone_visits_updated_at
    BEFORE UPDATE ON zone_visits
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create function to automatically assign zones to location logs
CREATE OR REPLACE FUNCTION assign_zone_to_location()
RETURNS TRIGGER AS $$
BEGIN
    -- Find the zone that contains this location point
    SELECT z.id INTO NEW.current_zone_id
    FROM zones z
    WHERE ST_Contains(z.boundaries, NEW.location)
    AND z.is_active = true
    AND (z.valid_until IS NULL OR z.valid_until > NEW.recorded_at)
    ORDER BY z.risk_level DESC -- Prefer higher risk zones for safety
    LIMIT 1;

    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for automatic zone assignment
CREATE TRIGGER assign_zone_to_location_trigger
    BEFORE INSERT ON location_logs
    FOR EACH ROW
    EXECUTE FUNCTION assign_zone_to_location();

-- Create function to automatically create zone visits
CREATE OR REPLACE FUNCTION manage_zone_visits()
RETURNS TRIGGER AS $$
DECLARE
    current_visit_id UUID;
    previous_zone_id UUID;
BEGIN
    -- Get the user's most recent zone
    SELECT current_zone_id INTO previous_zone_id
    FROM location_logs
    WHERE user_id = NEW.user_id
    AND recorded_at < NEW.recorded_at
    ORDER BY recorded_at DESC
    LIMIT 1;

    -- If entering a new zone
    IF NEW.current_zone_id IS NOT NULL AND (previous_zone_id IS NULL OR previous_zone_id != NEW.current_zone_id) THEN
        -- Close any open visits for different zones
        UPDATE zone_visits
        SET exited_at = NEW.recorded_at,
            exit_location = NEW.location
        WHERE user_id = NEW.user_id
        AND exited_at IS NULL
        AND zone_id != NEW.current_zone_id;

        -- Create new zone visit if not already exists
        INSERT INTO zone_visits (user_id, zone_id, entered_at, entry_location)
        VALUES (NEW.user_id, NEW.current_zone_id, NEW.recorded_at, NEW.location)
        ON CONFLICT DO NOTHING;
    END IF;

    -- If leaving all zones (current_zone_id is NULL)
    IF NEW.current_zone_id IS NULL AND previous_zone_id IS NOT NULL THEN
        UPDATE zone_visits
        SET exited_at = NEW.recorded_at,
            exit_location = NEW.location
        WHERE user_id = NEW.user_id
        AND exited_at IS NULL;
    END IF;

    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for automatic zone visit management
CREATE TRIGGER manage_zone_visits_trigger
    AFTER INSERT ON location_logs
    FOR EACH ROW
    EXECUTE FUNCTION manage_zone_visits();

-- Add comments for documentation
COMMENT ON TABLE zones IS 'Geospatial zones with polygon boundaries and safety classifications';
COMMENT ON TABLE location_logs IS 'GPS location tracking with accuracy metrics and zone assignments';
COMMENT ON TABLE zone_visits IS 'User visits to specific zones with entry/exit tracking';

COMMENT ON COLUMN zones.boundaries IS 'PostGIS polygon geometry defining zone boundaries (WGS84)';
COMMENT ON COLUMN zones.risk_level IS 'Safety risk level from 1 (safest) to 10 (most dangerous)';
COMMENT ON COLUMN location_logs.location IS 'PostGIS point geometry for GPS coordinates (WGS84)';
COMMENT ON COLUMN location_logs.accuracy_meters IS 'GPS accuracy radius in meters';
COMMENT ON COLUMN zone_visits.duration_minutes IS 'Calculated visit duration in minutes';