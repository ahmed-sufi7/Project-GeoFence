-- Create Core User Tables for Smart Tourist Safety Monitoring System
-- Migration: create_core_user_tables

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- Create Users table with blockchain-generated UUID primary keys
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true,
    blockchain_wallet_address VARCHAR(100),
    -- Audit fields
    created_by UUID,
    updated_by UUID
);

-- Create User Profiles table with KYC document fields
CREATE TABLE user_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    date_of_birth DATE,
    nationality VARCHAR(100),
    passport_number VARCHAR(50),
    national_id VARCHAR(50),
    address TEXT,
    city VARCHAR(100),
    country VARCHAR(100),
    postal_code VARCHAR(20),
    -- KYC Document fields
    kyc_status VARCHAR(50) DEFAULT 'pending' CHECK (kyc_status IN ('pending', 'verified', 'rejected', 'expired')),
    kyc_document_type VARCHAR(50) CHECK (kyc_document_type IN ('passport', 'national_id', 'drivers_license')),
    kyc_document_number VARCHAR(100),
    kyc_document_expiry DATE,
    kyc_verified_at TIMESTAMP WITH TIME ZONE,
    kyc_verified_by UUID,
    -- Profile image and preferences
    profile_image_url TEXT,
    language_preference VARCHAR(10) DEFAULT 'en',
    timezone VARCHAR(50) DEFAULT 'UTC',
    emergency_medical_info TEXT,
    allergies TEXT,
    medical_conditions TEXT,
    blood_type VARCHAR(5),
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,
    UNIQUE(user_id)
);

-- Create Emergency Contacts table with multiple contacts per user
CREATE TABLE emergency_contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_name VARCHAR(100) NOT NULL,
    relationship VARCHAR(50) NOT NULL,
    phone_primary VARCHAR(20) NOT NULL,
    phone_secondary VARCHAR(20),
    email VARCHAR(255),
    address TEXT,
    is_primary BOOLEAN DEFAULT false,
    priority_order INTEGER DEFAULT 1,
    -- Additional contact information
    notes TEXT,
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID,
    updated_by UUID
);

-- Create indexes for better performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_blockchain_wallet ON users(blockchain_wallet_address);
CREATE INDEX idx_users_created_at ON users(created_at);
CREATE INDEX idx_users_is_active ON users(is_active);

CREATE INDEX idx_user_profiles_user_id ON user_profiles(user_id);
CREATE INDEX idx_user_profiles_kyc_status ON user_profiles(kyc_status);
CREATE INDEX idx_user_profiles_nationality ON user_profiles(nationality);
CREATE INDEX idx_user_profiles_country ON user_profiles(country);

CREATE INDEX idx_emergency_contacts_user_id ON emergency_contacts(user_id);
CREATE INDEX idx_emergency_contacts_is_primary ON emergency_contacts(is_primary);
CREATE INDEX idx_emergency_contacts_priority ON emergency_contacts(priority_order);

-- Create trigger function for updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for automatic updated_at timestamp updates
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_profiles_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_emergency_contacts_updated_at
    BEFORE UPDATE ON emergency_contacts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create function to ensure only one primary emergency contact per user
CREATE OR REPLACE FUNCTION ensure_single_primary_emergency_contact()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_primary = true THEN
        -- Set all other contacts for this user to non-primary
        UPDATE emergency_contacts
        SET is_primary = false
        WHERE user_id = NEW.user_id AND id != NEW.id;
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for primary emergency contact constraint
CREATE TRIGGER enforce_single_primary_emergency_contact
    BEFORE INSERT OR UPDATE ON emergency_contacts
    FOR EACH ROW
    EXECUTE FUNCTION ensure_single_primary_emergency_contact();

-- Add comments for documentation
COMMENT ON TABLE users IS 'Core users table with blockchain integration';
COMMENT ON TABLE user_profiles IS 'Detailed user profiles with KYC verification';
COMMENT ON TABLE emergency_contacts IS 'Emergency contacts with priority ordering';

COMMENT ON COLUMN users.blockchain_wallet_address IS 'Blockchain wallet address for decentralized features';
COMMENT ON COLUMN user_profiles.kyc_status IS 'KYC verification status: pending, verified, rejected, expired';
COMMENT ON COLUMN emergency_contacts.is_primary IS 'Primary emergency contact (only one per user)';
COMMENT ON COLUMN emergency_contacts.priority_order IS 'Contact priority order (1 = highest priority)';