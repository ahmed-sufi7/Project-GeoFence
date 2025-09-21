-- Create BitChat P2P Network Table for Offline Communications
-- Migration: create_bitchat_p2p_network

-- Create P2P Network Nodes table for device registration and peer discovery
CREATE TABLE p2p_network_nodes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Node identification
    node_id VARCHAR(100) UNIQUE NOT NULL, -- Unique device/app identifier
    device_id VARCHAR(100) NOT NULL,
    device_name VARCHAR(100),
    device_type VARCHAR(50) CHECK (device_type IN ('mobile', 'tablet', 'desktop', 'iot', 'gateway')),
    -- Network addressing
    public_key TEXT NOT NULL, -- For encryption and identity verification
    network_address INET,
    port_number INTEGER CHECK (port_number BETWEEN 1024 AND 65535),
    -- Capabilities and features
    supported_protocols TEXT[] DEFAULT ARRAY['websocket', 'webrtc'], -- websocket, webrtc, bluetooth, wifi_direct
    max_connections INTEGER DEFAULT 50,
    storage_capacity_mb INTEGER,
    battery_powered BOOLEAN DEFAULT true,
    -- Network status
    is_online BOOLEAN DEFAULT false,
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    connection_quality DECIMAL(3, 2) CHECK (connection_quality BETWEEN 0 AND 1), -- 0-1 quality score
    network_type VARCHAR(20) CHECK (network_type IN ('wifi', '4g', '5g', '3g', 'ethernet', 'satellite')),
    -- Geographic information
    location GEOMETRY(POINT, 4326),
    location_accuracy_meters DECIMAL(6, 2),
    coverage_radius_meters INTEGER DEFAULT 1000, -- How far this node can reach
    -- P2P Network topology
    peer_count INTEGER DEFAULT 0,
    is_relay_node BOOLEAN DEFAULT false, -- Can relay messages for other nodes
    is_bridge_node BOOLEAN DEFAULT false, -- Connects different network segments
    mesh_level INTEGER DEFAULT 1, -- Depth in mesh network (1=edge, higher=more central)
    -- Performance metrics
    uptime_percentage DECIMAL(5, 2) CHECK (uptime_percentage BETWEEN 0 AND 100),
    message_throughput_per_minute INTEGER DEFAULT 0,
    data_transferred_mb DECIMAL(10, 2) DEFAULT 0,
    -- Security and trust
    trust_score DECIMAL(3, 2) DEFAULT 0.5 CHECK (trust_score BETWEEN 0 AND 1),
    verified_by_authority BOOLEAN DEFAULT false,
    blacklisted BOOLEAN DEFAULT false,
    reputation_score INTEGER DEFAULT 100,
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    first_connection_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create P2P Connections table to track peer relationships
CREATE TABLE p2p_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    node_from_id UUID NOT NULL REFERENCES p2p_network_nodes(id) ON DELETE CASCADE,
    node_to_id UUID NOT NULL REFERENCES p2p_network_nodes(id) ON DELETE CASCADE,
    -- Connection details
    connection_type VARCHAR(30) NOT NULL CHECK (connection_type IN ('direct', 'relay', 'bridge', 'mesh')),
    protocol_used VARCHAR(20) NOT NULL CHECK (protocol_used IN ('websocket', 'webrtc', 'bluetooth', 'wifi_direct')),
    -- Connection quality and performance
    latency_ms INTEGER,
    bandwidth_kbps INTEGER,
    reliability_score DECIMAL(3, 2) CHECK (reliability_score BETWEEN 0 AND 1),
    -- Connection status
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'established', 'active', 'idle', 'disconnected', 'failed')),
    established_at TIMESTAMP WITH TIME ZONE,
    last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    disconnected_at TIMESTAMP WITH TIME ZONE,
    -- Traffic statistics
    messages_sent INTEGER DEFAULT 0,
    messages_received INTEGER DEFAULT 0,
    bytes_sent BIGINT DEFAULT 0,
    bytes_received BIGINT DEFAULT 0,
    -- Error tracking
    connection_errors INTEGER DEFAULT 0,
    last_error_message TEXT,
    last_error_at TIMESTAMP WITH TIME ZONE,
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(node_from_id, node_to_id)
);

-- Create P2P Messages table for offline communication history
CREATE TABLE p2p_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id VARCHAR(100) UNIQUE NOT NULL, -- Unique message identifier across network
    -- Sender and receiver information
    sender_node_id UUID NOT NULL REFERENCES p2p_network_nodes(id),
    sender_user_id UUID NOT NULL REFERENCES users(id),
    recipient_user_id UUID REFERENCES users(id), -- NULL for broadcast messages
    -- Message routing
    route_path UUID[], -- Array of node IDs the message traveled through
    next_hop_node_id UUID REFERENCES p2p_network_nodes(id),
    target_zone_id UUID REFERENCES zones(id), -- For location-based messaging
    -- Message content and metadata
    message_type VARCHAR(30) NOT NULL CHECK (message_type IN ('emergency', 'safety_alert', 'chat', 'broadcast', 'system', 'heartbeat')),
    priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'emergency')),
    subject VARCHAR(200),
    content TEXT,
    encrypted_content TEXT, -- Encrypted version of content
    attachments_urls TEXT[],
    -- Delivery tracking
    delivery_status VARCHAR(30) DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'routing', 'delivered', 'failed', 'expired')),
    delivery_attempts INTEGER DEFAULT 0,
    max_delivery_attempts INTEGER DEFAULT 10,
    delivered_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '7 days'),
    -- Geographic context
    origin_location GEOMETRY(POINT, 4326),
    target_location GEOMETRY(POINT, 4326),
    target_radius_meters INTEGER,
    -- Message size and performance
    message_size_bytes INTEGER,
    compression_used BOOLEAN DEFAULT false,
    encryption_used BOOLEAN DEFAULT true,
    -- Network propagation
    hop_count INTEGER DEFAULT 0,
    max_hops INTEGER DEFAULT 10,
    propagation_radius_meters INTEGER DEFAULT 5000,
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create P2P Message Receipts table for delivery confirmation
CREATE TABLE p2p_message_receipts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id UUID NOT NULL REFERENCES p2p_messages(id) ON DELETE CASCADE,
    received_by_node_id UUID NOT NULL REFERENCES p2p_network_nodes(id),
    received_by_user_id UUID REFERENCES users(id),
    -- Receipt details
    receipt_type VARCHAR(20) NOT NULL CHECK (receipt_type IN ('received', 'read', 'acknowledged', 'failed')),
    received_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    read_at TIMESTAMP WITH TIME ZONE,
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    -- Delivery context
    received_via_node_id UUID REFERENCES p2p_network_nodes(id), -- Which node delivered it
    delivery_latency_ms INTEGER,
    hop_count INTEGER,
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(message_id, received_by_node_id)
);

-- Create indexes for performance
CREATE INDEX idx_p2p_nodes_user_id ON p2p_network_nodes(user_id);
CREATE INDEX idx_p2p_nodes_node_id ON p2p_network_nodes(node_id);
CREATE INDEX idx_p2p_nodes_is_online ON p2p_network_nodes(is_online);
CREATE INDEX idx_p2p_nodes_last_seen ON p2p_network_nodes(last_seen_at);
CREATE INDEX idx_p2p_nodes_location ON p2p_network_nodes USING GIST (location);
CREATE INDEX idx_p2p_nodes_device_type ON p2p_network_nodes(device_type);
CREATE INDEX idx_p2p_nodes_is_relay ON p2p_network_nodes(is_relay_node);
CREATE INDEX idx_p2p_nodes_trust_score ON p2p_network_nodes(trust_score);

CREATE INDEX idx_p2p_connections_from_node ON p2p_connections(node_from_id);
CREATE INDEX idx_p2p_connections_to_node ON p2p_connections(node_to_id);
CREATE INDEX idx_p2p_connections_status ON p2p_connections(status);
CREATE INDEX idx_p2p_connections_type ON p2p_connections(connection_type);
CREATE INDEX idx_p2p_connections_last_activity ON p2p_connections(last_activity_at);

CREATE INDEX idx_p2p_messages_sender_node ON p2p_messages(sender_node_id);
CREATE INDEX idx_p2p_messages_sender_user ON p2p_messages(sender_user_id);
CREATE INDEX idx_p2p_messages_recipient_user ON p2p_messages(recipient_user_id);
CREATE INDEX idx_p2p_messages_message_type ON p2p_messages(message_type);
CREATE INDEX idx_p2p_messages_priority ON p2p_messages(priority);
CREATE INDEX idx_p2p_messages_delivery_status ON p2p_messages(delivery_status);
CREATE INDEX idx_p2p_messages_sent_at ON p2p_messages(sent_at);
CREATE INDEX idx_p2p_messages_expires_at ON p2p_messages(expires_at);
CREATE INDEX idx_p2p_messages_origin_location ON p2p_messages USING GIST (origin_location);
CREATE INDEX idx_p2p_messages_target_zone ON p2p_messages(target_zone_id);

CREATE INDEX idx_p2p_receipts_message_id ON p2p_message_receipts(message_id);
CREATE INDEX idx_p2p_receipts_received_by_node ON p2p_message_receipts(received_by_node_id);
CREATE INDEX idx_p2p_receipts_received_by_user ON p2p_message_receipts(received_by_user_id);
CREATE INDEX idx_p2p_receipts_receipt_type ON p2p_message_receipts(receipt_type);
CREATE INDEX idx_p2p_receipts_received_at ON p2p_message_receipts(received_at);

-- Create triggers for updated_at timestamps
CREATE TRIGGER update_p2p_nodes_updated_at
    BEFORE UPDATE ON p2p_network_nodes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_p2p_connections_updated_at
    BEFORE UPDATE ON p2p_connections
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_p2p_messages_updated_at
    BEFORE UPDATE ON p2p_messages
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create function to update node activity timestamp
CREATE OR REPLACE FUNCTION update_node_activity()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE p2p_network_nodes
    SET last_activity_at = NOW(),
        is_online = true
    WHERE id = NEW.sender_node_id;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to update node activity when sending messages
CREATE TRIGGER update_node_activity_on_message
    AFTER INSERT ON p2p_messages
    FOR EACH ROW
    EXECUTE FUNCTION update_node_activity();

-- Create function to generate unique message IDs
CREATE OR REPLACE FUNCTION generate_message_id()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.message_id IS NULL THEN
        NEW.message_id = 'MSG-' || NEW.sender_node_id || '-' || EXTRACT(EPOCH FROM NOW())::TEXT;
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for automatic message ID generation
CREATE TRIGGER generate_message_id_trigger
    BEFORE INSERT ON p2p_messages
    FOR EACH ROW
    EXECUTE FUNCTION generate_message_id();

-- Create function to automatically create message receipts for the sender
CREATE OR REPLACE FUNCTION create_sender_receipt()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO p2p_message_receipts (message_id, received_by_node_id, received_by_user_id, receipt_type)
    VALUES (NEW.id, NEW.sender_node_id, NEW.sender_user_id, 'received');
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for automatic sender receipt creation
CREATE TRIGGER create_sender_receipt_trigger
    AFTER INSERT ON p2p_messages
    FOR EACH ROW
    EXECUTE FUNCTION create_sender_receipt();

-- Add comments for documentation
COMMENT ON TABLE p2p_network_nodes IS 'P2P network nodes for decentralized communication and mesh networking';
COMMENT ON TABLE p2p_connections IS 'Direct connections between P2P network nodes';
COMMENT ON TABLE p2p_messages IS 'Messages sent through the P2P network with routing information';
COMMENT ON TABLE p2p_message_receipts IS 'Delivery confirmations and read receipts for P2P messages';

COMMENT ON COLUMN p2p_network_nodes.node_id IS 'Unique identifier for the device/app instance in P2P network';
COMMENT ON COLUMN p2p_network_nodes.public_key IS 'Public key for encryption and digital signatures';
COMMENT ON COLUMN p2p_network_nodes.trust_score IS 'Trust level from 0-1 based on network behavior';
COMMENT ON COLUMN p2p_messages.route_path IS 'Array of node IDs showing message routing path';
COMMENT ON COLUMN p2p_messages.hop_count IS 'Number of network hops the message has traveled';
COMMENT ON COLUMN p2p_message_receipts.delivery_latency_ms IS 'Time in milliseconds from send to receipt';