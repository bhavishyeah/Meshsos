-- Migration: 003_auto_dispatch
-- Description: Add auto-dispatch support - assigned_station_id on SOS incidents
--              and operator_user_id on stations for station panel access.

-- Add assigned_station_id to sos_incidents for auto-dispatch routing
ALTER TABLE sos_incidents
  ADD COLUMN assigned_station_id UUID REFERENCES stations(id);

CREATE INDEX idx_sos_assigned_station ON sos_incidents(assigned_station_id);

-- Add operator_user_id to stations so station operators can access their panel
ALTER TABLE stations
  ADD COLUMN operator_user_id UUID REFERENCES users(id);

CREATE INDEX idx_stations_operator ON stations(operator_user_id);
