-- Fix Extensions and Create Tables
-- Properly enable extensions and create all required tables

-- Enable extensions with proper schema
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS "postgis" WITH SCHEMA public;

-- Create Users table
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true,
    blockchain_wallet_address VARCHAR(100)
);

-- Create User Profiles table
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    date_of_birth DATE,
    nationality VARCHAR(100),
    kyc_status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id)
);

-- Create Emergency Contacts table
CREATE TABLE IF NOT EXISTS public.emergency_contacts (
    id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    contact_name VARCHAR(100) NOT NULL,
    relationship VARCHAR(50) NOT NULL,
    phone_primary VARCHAR(20) NOT NULL,
    phone_secondary VARCHAR(20),
    email VARCHAR(255),
    is_primary BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create Zones table
CREATE TABLE IF NOT EXISTS public.zones (
    id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    zone_name VARCHAR(100) NOT NULL,
    zone_type VARCHAR(50) NOT NULL,
    description TEXT,
    boundaries public.GEOMETRY(POLYGON, 4326) NOT NULL,
    center_point public.GEOMETRY(POINT, 4326),
    risk_level INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    country VARCHAR(100),
    city VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create Location Logs table
CREATE TABLE IF NOT EXISTS public.location_logs (
    id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    location public.GEOMETRY(POINT, 4326) NOT NULL,
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    altitude DECIMAL(8, 2),
    accuracy_meters DECIMAL(6, 2),
    current_zone_id UUID REFERENCES public.zones(id),
    recorded_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create Safety Scores table
CREATE TABLE IF NOT EXISTS public.safety_scores (
    id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    zone_id UUID REFERENCES public.zones(id),
    overall_score DECIMAL(5, 2) NOT NULL,
    location public.GEOMETRY(POINT, 4326),
    calculated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create Incidents table
CREATE TABLE IF NOT EXISTS public.incidents (
    id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    incident_number VARCHAR(50) UNIQUE NOT NULL DEFAULT ('INC-' || EXTRACT(EPOCH FROM NOW())::TEXT),
    reported_by_user_id UUID REFERENCES public.users(id),
    incident_type VARCHAR(50) NOT NULL,
    severity_level INTEGER NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    location public.GEOMETRY(POINT, 4326),
    zone_id UUID REFERENCES public.zones(id),
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(30) DEFAULT 'reported',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create Alerts table
CREATE TABLE IF NOT EXISTS public.alerts (
    id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    alert_code VARCHAR(50) UNIQUE NOT NULL DEFAULT ('ALT-' || EXTRACT(EPOCH FROM NOW())::TEXT),
    alert_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    target_user_id UUID REFERENCES public.users(id),
    target_zone_id UUID REFERENCES public.zones(id),
    issued_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create Alert Recipients table
CREATE TABLE IF NOT EXISTS public.alert_recipients (
    id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    alert_id UUID NOT NULL REFERENCES public.alerts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    delivery_channel VARCHAR(20) NOT NULL,
    delivery_status VARCHAR(30) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(alert_id, user_id, delivery_channel)
);

-- Create P2P Network Nodes table
CREATE TABLE IF NOT EXISTS public.p2p_network_nodes (
    id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    node_id VARCHAR(100) UNIQUE NOT NULL,
    device_id VARCHAR(100) NOT NULL,
    device_name VARCHAR(100),
    public_key TEXT NOT NULL,
    is_online BOOLEAN DEFAULT false,
    location public.GEOMETRY(POINT, 4326),
    trust_score DECIMAL(3, 2) DEFAULT 0.5,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create P2P Messages table
CREATE TABLE IF NOT EXISTS public.p2p_messages (
    id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    message_id VARCHAR(100) UNIQUE NOT NULL DEFAULT ('MSG-' || EXTRACT(EPOCH FROM NOW())::TEXT),
    sender_node_id UUID NOT NULL REFERENCES public.p2p_network_nodes(id),
    sender_user_id UUID NOT NULL REFERENCES public.users(id),
    recipient_user_id UUID REFERENCES public.users(id),
    message_type VARCHAR(30) NOT NULL,
    content TEXT,
    delivery_status VARCHAR(30) DEFAULT 'pending',
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create essential indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_location_logs_user_id ON public.location_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_location_logs_location ON public.location_logs USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_zones_boundaries ON public.zones USING GIST (boundaries);
CREATE INDEX IF NOT EXISTS idx_incidents_zone_id ON public.incidents(zone_id);
CREATE INDEX IF NOT EXISTS idx_alerts_target_user ON public.alerts(target_user_id);