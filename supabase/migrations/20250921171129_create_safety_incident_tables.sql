-- Create Safety and Incident Tracking Tables
-- Migration: create_safety_incident_tables

-- Create Safety Scores table with dynamic calculations
CREATE TABLE safety_scores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    zone_id UUID REFERENCES zones(id),
    -- Score calculations
    overall_score DECIMAL(5, 2) NOT NULL CHECK (overall_score BETWEEN 0 AND 100),
    location_risk_score DECIMAL(5, 2) CHECK (location_risk_score BETWEEN 0 AND 100),
    behavioral_score DECIMAL(5, 2) CHECK (behavioral_score BETWEEN 0 AND 100),
    historical_score DECIMAL(5, 2) CHECK (historical_score BETWEEN 0 AND 100),
    crowd_density_score DECIMAL(5, 2) CHECK (crowd_density_score BETWEEN 0 AND 100),
    time_of_day_score DECIMAL(5, 2) CHECK (time_of_day_score BETWEEN 0 AND 100),
    weather_score DECIMAL(5, 2) CHECK (weather_score BETWEEN 0 AND 100),
    -- Score metadata
    calculation_method VARCHAR(50) DEFAULT 'weighted_average',
    confidence_level DECIMAL(3, 2) CHECK (confidence_level BETWEEN 0 AND 1),
    data_sources TEXT[], -- Array of data sources used in calculation
    -- Location context
    location GEOMETRY(POINT, 4326),
    -- Temporal information
    calculated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    valid_until TIMESTAMP WITH TIME ZONE,
    -- Risk factors
    risk_factors JSONB,
    recommendations TEXT[],
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create Incidents table for emergency tracking
CREATE TABLE incidents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    incident_number VARCHAR(50) UNIQUE NOT NULL,
    -- Reporting information
    reported_by_user_id UUID REFERENCES users(id),
    reporter_name VARCHAR(200),
    reporter_phone VARCHAR(20),
    reporter_email VARCHAR(255),
    -- Incident classification
    incident_type VARCHAR(50) NOT NULL CHECK (incident_type IN ('medical', 'crime', 'accident', 'natural_disaster', 'fire', 'security', 'lost_person', 'suspicious_activity', 'other')),
    severity_level INTEGER NOT NULL CHECK (severity_level BETWEEN 1 AND 5), -- 1=minor, 5=critical
    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    -- Incident details
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    affected_users_count INTEGER DEFAULT 1,
    casualties_count INTEGER DEFAULT 0,
    -- Location information
    location GEOMETRY(POINT, 4326),
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    address TEXT,
    zone_id UUID REFERENCES zones(id),
    landmark_description TEXT,
    -- Timing
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
    reported_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Status and resolution
    status VARCHAR(30) DEFAULT 'reported' CHECK (status IN ('reported', 'acknowledged', 'investigating', 'responding', 'resolved', 'closed', 'false_alarm')),
    resolution_notes TEXT,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by UUID REFERENCES users(id),
    -- Emergency response
    emergency_services_notified BOOLEAN DEFAULT false,
    emergency_services_contacted_at TIMESTAMP WITH TIME ZONE,
    response_time_minutes INTEGER,
    first_responder_arrival_at TIMESTAMP WITH TIME ZONE,
    -- Media and evidence
    images_urls TEXT[],
    video_urls TEXT[],
    document_urls TEXT[],
    -- Additional metadata
    weather_conditions TEXT,
    visibility_conditions VARCHAR(50),
    crowd_size_estimate INTEGER,
    tags TEXT[],
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id)
);

-- Create Alerts table for notifications
CREATE TABLE alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_code VARCHAR(50) UNIQUE NOT NULL,
    -- Alert classification
    alert_type VARCHAR(50) NOT NULL CHECK (alert_type IN ('safety_warning', 'emergency_broadcast', 'zone_alert', 'personal_alert', 'system_notification', 'weather_alert', 'security_alert')),
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
    urgency VARCHAR(20) NOT NULL CHECK (urgency IN ('immediate', 'expected', 'future', 'past')),
    -- Alert content
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    detailed_instructions TEXT,
    recommended_actions TEXT[],
    -- Targeting and delivery
    target_user_id UUID REFERENCES users(id), -- For personal alerts
    target_zone_id UUID REFERENCES zones(id), -- For zone-based alerts
    target_audience VARCHAR(50) CHECK (target_audience IN ('all_users', 'zone_users', 'specific_user', 'user_group', 'emergency_contacts')),
    delivery_channels TEXT[] DEFAULT ARRAY['in_app'], -- in_app, sms, email, push, voice_call
    -- Geographic targeting
    target_location GEOMETRY(POINT, 4326),
    target_radius_meters INTEGER,
    affected_zones UUID[],
    -- Timing and scheduling
    issued_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    effective_from TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    -- Delivery status
    delivery_status VARCHAR(30) DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'sending', 'sent', 'delivered', 'failed', 'cancelled')),
    delivery_attempts INTEGER DEFAULT 0,
    successful_deliveries INTEGER DEFAULT 0,
    failed_deliveries INTEGER DEFAULT 0,
    -- Source information
    source_incident_id UUID REFERENCES incidents(id),
    issuer_authority VARCHAR(100),
    source_system VARCHAR(50),
    -- Alert lifecycle
    is_active BOOLEAN DEFAULT true,
    is_cancelled BOOLEAN DEFAULT false,
    cancelled_at TIMESTAMP WITH TIME ZONE,
    cancelled_by UUID REFERENCES users(id),
    cancellation_reason TEXT,
    -- Alert updates and follow-ups
    supersedes_alert_id UUID REFERENCES alerts(id),
    follow_up_required BOOLEAN DEFAULT false,
    follow_up_interval_hours INTEGER,
    -- Acknowledgment tracking
    requires_acknowledgment BOOLEAN DEFAULT false,
    acknowledgment_count INTEGER DEFAULT 0,
    -- Additional metadata
    alert_category VARCHAR(50),
    tags TEXT[],
    external_alert_id VARCHAR(100),
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id)
);

-- Create Alert Recipients table for tracking individual deliveries
CREATE TABLE alert_recipients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Delivery information
    delivery_channel VARCHAR(20) NOT NULL CHECK (delivery_channel IN ('in_app', 'sms', 'email', 'push', 'voice_call')),
    delivery_address VARCHAR(255), -- phone, email, device token, etc.
    -- Delivery status
    delivery_status VARCHAR(30) DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'sent', 'delivered', 'read', 'acknowledged', 'failed')),
    delivery_attempted_at TIMESTAMP WITH TIME ZONE,
    delivery_completed_at TIMESTAMP WITH TIME ZONE,
    failure_reason TEXT,
    retry_count INTEGER DEFAULT 0,
    -- User interaction
    read_at TIMESTAMP WITH TIME ZONE,
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    user_response TEXT,
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(alert_id, user_id, delivery_channel)
);

-- Create indexes for performance
CREATE INDEX idx_safety_scores_user_id ON safety_scores(user_id);
CREATE INDEX idx_safety_scores_zone_id ON safety_scores(zone_id);
CREATE INDEX idx_safety_scores_calculated_at ON safety_scores(calculated_at);
CREATE INDEX idx_safety_scores_overall_score ON safety_scores(overall_score);
CREATE INDEX idx_safety_scores_location ON safety_scores USING GIST (location);
CREATE INDEX idx_safety_scores_user_calculated ON safety_scores(user_id, calculated_at);

CREATE INDEX idx_incidents_incident_number ON incidents(incident_number);
CREATE INDEX idx_incidents_reported_by ON incidents(reported_by_user_id);
CREATE INDEX idx_incidents_type ON incidents(incident_type);
CREATE INDEX idx_incidents_severity ON incidents(severity_level);
CREATE INDEX idx_incidents_status ON incidents(status);
CREATE INDEX idx_incidents_occurred_at ON incidents(occurred_at);
CREATE INDEX idx_incidents_reported_at ON incidents(reported_at);
CREATE INDEX idx_incidents_location ON incidents USING GIST (location);
CREATE INDEX idx_incidents_zone_id ON incidents(zone_id);
CREATE INDEX idx_incidents_priority ON incidents(priority);

CREATE INDEX idx_alerts_alert_code ON alerts(alert_code);
CREATE INDEX idx_alerts_type ON alerts(alert_type);
CREATE INDEX idx_alerts_severity ON alerts(severity);
CREATE INDEX idx_alerts_target_user ON alerts(target_user_id);
CREATE INDEX idx_alerts_target_zone ON alerts(target_zone_id);
CREATE INDEX idx_alerts_issued_at ON alerts(issued_at);
CREATE INDEX idx_alerts_effective_from ON alerts(effective_from);
CREATE INDEX idx_alerts_expires_at ON alerts(expires_at);
CREATE INDEX idx_alerts_delivery_status ON alerts(delivery_status);
CREATE INDEX idx_alerts_is_active ON alerts(is_active);
CREATE INDEX idx_alerts_source_incident ON alerts(source_incident_id);

CREATE INDEX idx_alert_recipients_alert_id ON alert_recipients(alert_id);
CREATE INDEX idx_alert_recipients_user_id ON alert_recipients(user_id);
CREATE INDEX idx_alert_recipients_delivery_status ON alert_recipients(delivery_status);
CREATE INDEX idx_alert_recipients_delivery_channel ON alert_recipients(delivery_channel);

-- Create trigger for updated_at timestamps
CREATE TRIGGER update_safety_scores_updated_at
    BEFORE UPDATE ON safety_scores
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_incidents_updated_at
    BEFORE UPDATE ON incidents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_alerts_updated_at
    BEFORE UPDATE ON alerts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_alert_recipients_updated_at
    BEFORE UPDATE ON alert_recipients
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create function to generate incident numbers
CREATE OR REPLACE FUNCTION generate_incident_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.incident_number IS NULL THEN
        NEW.incident_number = 'INC-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(EXTRACT(EPOCH FROM NOW())::TEXT, 10, '0');
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for automatic incident number generation
CREATE TRIGGER generate_incident_number_trigger
    BEFORE INSERT ON incidents
    FOR EACH ROW
    EXECUTE FUNCTION generate_incident_number();

-- Create function to generate alert codes
CREATE OR REPLACE FUNCTION generate_alert_code()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.alert_code IS NULL THEN
        NEW.alert_code = 'ALT-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(EXTRACT(EPOCH FROM NOW())::TEXT, 10, '0');
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for automatic alert code generation
CREATE TRIGGER generate_alert_code_trigger
    BEFORE INSERT ON alerts
    FOR EACH ROW
    EXECUTE FUNCTION generate_alert_code();

-- Add comments for documentation
COMMENT ON TABLE safety_scores IS 'Dynamic safety score calculations for users and locations';
COMMENT ON TABLE incidents IS 'Emergency incident tracking with location and response data';
COMMENT ON TABLE alerts IS 'Alert and notification management system';
COMMENT ON TABLE alert_recipients IS 'Individual alert delivery tracking';

COMMENT ON COLUMN safety_scores.overall_score IS 'Composite safety score from 0-100 (higher is safer)';
COMMENT ON COLUMN incidents.severity_level IS 'Incident severity: 1=minor, 2=moderate, 3=major, 4=severe, 5=critical';
COMMENT ON COLUMN alerts.delivery_channels IS 'Array of delivery methods: in_app, sms, email, push, voice_call';
COMMENT ON COLUMN alert_recipients.delivery_status IS 'Individual delivery status: pending, sent, delivered, read, acknowledged, failed';