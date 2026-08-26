-- Migration: 001_initial_schema
-- Description: Initial database schema for MeshSOS Emergency SOS Platform
-- Requires a PostgreSQL image with PostGIS available (Railway: use a
-- PostGIS-enabled Postgres template, not the plain Postgres image).

CREATE EXTENSION IF NOT EXISTS postgis;

-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role VARCHAR(20) NOT NULL CHECK (role IN ('survivor', 'responder', 'dispatcher', 'supervisor', 'administrator', 'auditor')),
  name VARCHAR(100),
  email VARCHAR(255) UNIQUE,
  password_hash VARCHAR(255),
  language VARCHAR(5) DEFAULT 'en',
  emergency_contact VARCHAR(20),
  mfa_enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Regions with geographic boundaries
CREATE TABLE regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  boundary GEOMETRY(Polygon, 4326) NOT NULL,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_regions_boundary ON regions USING GIST(boundary);

-- Stations
CREATE TABLE stations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL CHECK (type IN ('police', 'hospital', 'relief')),
  location GEOMETRY(Point, 4326) NOT NULL,
  region_id UUID REFERENCES regions(id),
  contact VARCHAR(100),
  capacity INTEGER,
  services JSONB,
  officer_count INTEGER,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_stations_location ON stations USING GIST(location);
CREATE INDEX idx_stations_type ON stations(type);
CREATE INDEX idx_stations_region ON stations(region_id);
CREATE INDEX idx_stations_status ON stations(status);

-- Responders
CREATE TABLE responders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  organization VARCHAR(255),
  station_id UUID REFERENCES stations(id),
  type VARCHAR(50) NOT NULL CHECK (type IN ('police', 'medical', 'rescue', 'relief', 'social')),
  current_location GEOMETRY(Point, 4326),
  location_updated_at TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'offline' CHECK (status IN ('available', 'busy', 'assigned', 'enRoute', 'onScene', 'offline')),
  current_incident_id UUID,
  vehicle VARCHAR(100),
  capabilities JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_responders_location ON responders USING GIST(current_location);
CREATE INDEX idx_responders_status ON responders(status);
CREATE INDEX idx_responders_type ON responders(type);

-- SOS Incidents
CREATE TABLE sos_incidents (
  id UUID PRIMARY KEY,
  user_session_id VARCHAR(255),
  user_id UUID REFERENCES users(id),
  emergency_type VARCHAR(20) NOT NULL CHECK (emergency_type IN ('police', 'medical', 'food', 'childrenElderly')),
  location GEOMETRY(Point, 4326),
  accuracy REAL,
  location_method VARCHAR(10),
  location_timestamp TIMESTAMPTZ,
  people_count INTEGER,
  situation_type VARCHAR(50),
  description VARCHAR(200),
  priority_score INTEGER DEFAULT 0,
  priority_band VARCHAR(10) DEFAULT 'low' CHECK (priority_band IN ('critical', 'high', 'medium', 'low')),
  status VARCHAR(20) DEFAULT 'delivered' CHECK (status IN ('delivered', 'acknowledged', 'dispatched', 'enRoute', 'arrived', 'resolved', 'cancelled', 'failed')),
  region_id UUID REFERENCES regions(id),
  assigned_responder_id UUID REFERENCES responders(id),
  disaster_event_id UUID,
  duplicate_flag BOOLEAN DEFAULT false,
  duplicate_of UUID REFERENCES sos_incidents(id),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sos_location ON sos_incidents USING GIST(location);
CREATE INDEX idx_sos_status ON sos_incidents(status);
CREATE INDEX idx_sos_region ON sos_incidents(region_id);
CREATE INDEX idx_sos_priority ON sos_incidents(priority_band);
CREATE INDEX idx_sos_created_at ON sos_incidents(created_at);
CREATE INDEX idx_sos_emergency_type ON sos_incidents(emergency_type);

-- SOS Lifecycle Events
CREATE TABLE sos_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sos_id UUID REFERENCES sos_incidents(id) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  actor_id UUID,
  previous_state VARCHAR(20),
  new_state VARCHAR(20),
  metadata JSONB,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sos_events_sos_id ON sos_events(sos_id);
CREATE INDEX idx_sos_events_timestamp ON sos_events(timestamp);

-- Audit Trail (append-only)
CREATE TABLE audit_trail (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sos_id UUID,
  event_type VARCHAR(100) NOT NULL,
  actor_id UUID,
  target_entity_id UUID,
  previous_value JSONB,
  new_value JSONB,
  metadata JSONB,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_sos ON audit_trail(sos_id);
CREATE INDEX idx_audit_actor ON audit_trail(actor_id);
CREATE INDEX idx_audit_type ON audit_trail(event_type);
CREATE INDEX idx_audit_timestamp ON audit_trail(timestamp);

-- Disaster Events
CREATE TABLE disaster_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  region_id UUID REFERENCES regions(id),
  severity VARCHAR(20) CHECK (severity IN ('low', 'moderate', 'high', 'critical')),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'monitoring')),
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_disaster_events_region ON disaster_events(region_id);
CREATE INDEX idx_disaster_events_status ON disaster_events(status);

ALTER TABLE sos_incidents
  ADD CONSTRAINT fk_sos_disaster_event
  FOREIGN KEY (disaster_event_id) REFERENCES disaster_events(id);

-- Push Subscriptions
CREATE TABLE push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_session_id VARCHAR(255),
  user_id UUID REFERENCES users(id),
  endpoint TEXT NOT NULL UNIQUE,
  keys JSONB NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id);
CREATE INDEX idx_push_subscriptions_session ON push_subscriptions(user_session_id);

-- Sessions
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  device_info JSONB,
  expires_at TIMESTAMPTZ NOT NULL,
  last_active_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- Audit Trail Immutability
CREATE OR REPLACE FUNCTION prevent_audit_trail_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_trail table is append-only.';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_trail_no_update
  BEFORE UPDATE ON audit_trail FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_trail_modification();

CREATE TRIGGER audit_trail_no_delete
  BEFORE DELETE ON audit_trail FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_trail_modification();

REVOKE UPDATE, DELETE ON audit_trail FROM PUBLIC;

-- Updated_at Trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_stations_updated_at
  BEFORE UPDATE ON stations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_responders_updated_at
  BEFORE UPDATE ON responders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_sos_incidents_updated_at
  BEFORE UPDATE ON sos_incidents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
