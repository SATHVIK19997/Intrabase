-- =============================================================================
-- IntraBase — PostgreSQL Initialization Script
-- This runs once when the PostgreSQL container starts for the first time
-- =============================================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- SYSTEM SCHEMA
-- All IntraBase internal tables live in the intrabase_system schema
-- User tables live in the public schema
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS intrabase_system;

-- =============================================================================
-- USERS TABLE
-- Populated from Google OAuth — no passwords stored
-- =============================================================================

CREATE TABLE IF NOT EXISTS intrabase_system.users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT        UNIQUE NOT NULL,
  name          TEXT,
  avatar_url    TEXT,
  role          TEXT        NOT NULL DEFAULT 'viewer'
                            CHECK (role IN ('admin', 'editor', 'viewer')),
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE intrabase_system.users IS 'Internal users authenticated via Google OAuth';

-- =============================================================================
-- SESSIONS TABLE
-- Stores refresh tokens for JWT rotation
-- =============================================================================

CREATE TABLE IF NOT EXISTS intrabase_system.sessions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES intrabase_system.users(id) ON DELETE CASCADE,
  refresh_token TEXT        NOT NULL UNIQUE,
  ip_address    TEXT,
  user_agent    TEXT,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE intrabase_system.sessions IS 'JWT refresh token sessions';

-- =============================================================================
-- API KEYS TABLE
-- Long-lived keys for service-to-service auth
-- =============================================================================

CREATE TABLE IF NOT EXISTS intrabase_system.api_keys (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES intrabase_system.users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  key_prefix  TEXT        NOT NULL,         -- First 8 chars of key (for display only)
  key_hash    TEXT        NOT NULL,         -- bcrypt hash of full key
  last_used_at TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ,                  -- NULL = never expires
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE intrabase_system.api_keys IS 'API keys for programmatic access. Full key stored as bcrypt hash.';

-- =============================================================================
-- AUDIT LOGS TABLE
-- Logs every API call
-- =============================================================================

CREATE TABLE IF NOT EXISTS intrabase_system.audit_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        REFERENCES intrabase_system.users(id) ON DELETE SET NULL,
  method      TEXT,                         -- HTTP method: GET, POST, PATCH, DELETE
  path        TEXT,                         -- Request path
  table_name  TEXT,                         -- Target table (for REST API calls)
  query_sql   TEXT,                         -- Executed SQL (sanitized)
  ip_address  TEXT,
  status_code INTEGER,                      -- HTTP response status
  duration_ms INTEGER,                      -- Request duration in ms
  error_msg   TEXT,                         -- Error message if any
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE intrabase_system.audit_logs IS 'Audit trail for all API calls and dashboard actions';

-- =============================================================================
-- INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_users_email           ON intrabase_system.users(email);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id      ON intrabase_system.sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_refresh      ON intrabase_system.sessions(refresh_token);
CREATE INDEX IF NOT EXISTS idx_sessions_expires      ON intrabase_system.sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id      ON intrabase_system.api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix       ON intrabase_system.api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id    ON intrabase_system.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON intrabase_system.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table      ON intrabase_system.audit_logs(table_name);

-- =============================================================================
-- UPDATED_AT TRIGGER
-- Automatically updates updated_at column
-- =============================================================================

CREATE OR REPLACE FUNCTION intrabase_system.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_users_updated_at
  BEFORE UPDATE ON intrabase_system.users
  FOR EACH ROW EXECUTE FUNCTION intrabase_system.set_updated_at();

-- =============================================================================
-- CLEANUP FUNCTION
-- Remove expired sessions and audit logs older than 90 days
-- Call periodically via a scheduled job or pg_cron
-- =============================================================================

-- =============================================================================
-- REALTIME NOTIFY TRIGGER FUNCTION
-- Attach to any user table to broadcast changes via pg_notify
-- =============================================================================

CREATE OR REPLACE FUNCTION intrabase_system.notify_realtime()
RETURNS TRIGGER AS $$
DECLARE
  project_id  UUID;
  record_data JSONB;
  payload     TEXT;
BEGIN
  SELECT id INTO project_id
  FROM intrabase_system.projects
  WHERE slug = TG_TABLE_SCHEMA
  LIMIT 1;

  IF TG_OP = 'DELETE' THEN
    record_data := to_jsonb(OLD);
  ELSE
    record_data := to_jsonb(NEW);
  END IF;

  payload := json_build_object(
    'projectId', project_id,
    'schema',    TG_TABLE_SCHEMA,
    'table',     TG_TABLE_NAME,
    'op',        TG_OP,
    'record',    record_data
  )::TEXT;

  PERFORM pg_notify('intrabase_realtime', payload);

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- CLEANUP FUNCTION
-- Remove expired sessions and audit logs older than 90 days
-- =============================================================================

CREATE OR REPLACE FUNCTION intrabase_system.cleanup_expired()
RETURNS void AS $$
BEGIN
  -- Remove expired refresh token sessions
  DELETE FROM intrabase_system.sessions WHERE expires_at < now();
  -- Remove audit logs older than 90 days
  DELETE FROM intrabase_system.audit_logs WHERE created_at < now() - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- FIRST ADMIN PLACEHOLDER
-- The first user to sign in with Google will be automatically promoted to admin
-- by the API service (since the users table is empty)
-- =============================================================================

-- =============================================================================
-- SAMPLE PUBLIC SCHEMA TABLES
-- These are example tables to demonstrate the REST API
-- Remove or replace with your actual tables
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.example_projects (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  description TEXT,
  status      TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  owner_email TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.example_projects (name, description, status, owner_email) VALUES
  ('IntraBase', 'Internal database platform', 'active', NULL),
  ('Sample Project', 'Example project to show the table editor', 'active', NULL)
ON CONFLICT DO NOTHING;

-- =============================================================================
-- GRANTS
-- The intrabase_admin user already has full access (it owns all objects)
-- If you add additional DB users/roles for RLS, grant them here
-- =============================================================================

GRANT USAGE ON SCHEMA intrabase_system TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO CURRENT_USER;
