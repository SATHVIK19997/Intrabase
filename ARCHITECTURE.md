# IntraBase — Technical Architecture

---

## System Overview

```
                         INTERNET / INTERNAL NETWORK
                                    │
                                    ▼
                          ┌─────────────────┐
                          │      Nginx       │
                          │  Reverse Proxy   │
                          │   + SSL (443)    │
                          └────────┬────────┘
                                   │
               ┌───────────────────┼──────────────────┐
               │                   │                  │
               ▼                   ▼                  ▼
      ┌─────────────────┐ ┌──────────────┐  ┌──────────────────┐
      │   Dashboard     │ │  API Service │  │  (Phase 2)       │
      │   Next.js 14    │ │  Fastify +   │  │  Realtime Engine │
      │   Port: 3000    │ │  TypeScript  │  │  WebSocket       │
      └────────┬────────┘ │  Port: 3001  │  └──────────────────┘
               │           └──────┬───────┘
               │                  │
               │    ┌─────────────┘
               │    │
               ▼    ▼
      ┌──────────────────┐
      │    pgBouncer     │
      │ Connection Pool  │
      │   Port: 6432     │
      └────────┬─────────┘
               │
               ▼
      ┌──────────────────┐
      │   PostgreSQL 16  │
      │   Port: 5432     │
      │   (internal      │
      │    only)         │
      └──────────────────┘
```

---

## Nginx Routing Rules

| Path | Routes To | Notes |
|---|---|---|
| `/` | Dashboard (port 3000) | Main UI |
| `/api/*` | API Service (port 3001) | REST + Auth endpoints |
| `/api/auth/*` | API Service (port 3001) | Google OAuth flow |
| `/api/rest/*` | API Service (port 3001) | Auto REST engine |
| `/realtime` | Realtime (port 3002) | WebSocket upgrade (Phase 2) |

---

## Authentication Flow

```
User Browser                  Nginx            API Service         Google OAuth
     │                          │                   │                   │
     │── GET /api/auth/google ──▶│                   │                   │
     │                          │── proxy ──────────▶│                   │
     │                          │                   │── redirect ────────▶│
     │◀─────────────────────────────────────────────── 302 to Google ──────│
     │                          │                   │                   │
     │── Google sign-in ────────────────────────────────────────────────▶│
     │                          │                   │                   │
     │◀── redirect to /api/auth/google/callback?code=... ────────────────│
     │── GET /api/auth/google/callback ──▶│          │                   │
     │                          │── proxy ──────────▶│                   │
     │                          │                   │── exchange code ──▶│
     │                          │                   │◀── user profile ───│
     │                          │                   │                   │
     │                          │    [check email domain, upsert user]   │
     │                          │                   │                   │
     │                          │    [issue JWT + set httpOnly cookie]   │
     │◀── 302 to /dashboard ────│◀──────────────────│                   │
     │                          │                   │                   │
```

**JWT Payload:**
```json
{
  "sub": "user-uuid",
  "email": "user@yourcompany.com",
  "role": "editor",
  "iat": 1700000000,
  "exp": 1700028800
}
```

---

## REST API Engine — How It Works

### Schema Introspection (on startup)

```sql
SELECT
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;
```

This gives the engine a complete map of all tables and columns. Routes are registered dynamically.

### Request Lifecycle

```
Client Request
     │
     ▼
JWT/API Key Middleware ──→ 401 if invalid
     │
     ▼
Parse Query Params
  ?select=col1,col2
  ?status=eq.active
  ?order=created_at.desc
  ?limit=10&offset=0
     │
     ▼
Build Parameterized SQL Query
  SELECT col1, col2
  FROM {table}
  WHERE status = $1
  ORDER BY created_at DESC
  LIMIT 10 OFFSET 0
     │
     ▼
Execute via pgBouncer → PostgreSQL
(as role matching JWT user — RLS applies)
     │
     ▼
Return JSON Response
```

### Filter → SQL Translation

```
?age=gte.18         →  WHERE age >= $1
?name=ilike.%john%  →  WHERE name ILIKE $1
?id=in.(1,2,3)      →  WHERE id = ANY($1)
?deleted_at=is.null →  WHERE deleted_at IS NULL
?select=id,name     →  SELECT id, name
?order=name.asc     →  ORDER BY name ASC
?limit=20&offset=40 →  LIMIT 20 OFFSET 40
```

---

## Database Schema

### System Tables (created in init.sql)

```sql
-- Internal users (populated from Google OAuth)
CREATE TABLE intrabase_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  name          TEXT,
  avatar_url    TEXT,
  role          TEXT NOT NULL DEFAULT 'viewer',  -- admin | editor | viewer
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- API Keys (for service-to-service auth)
CREATE TABLE intrabase_api_keys (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES intrabase_users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  key_prefix TEXT NOT NULL,           -- first 8 chars of key (for display)
  key_hash   TEXT NOT NULL,           -- bcrypt hash of full key
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Audit log (every API call)
CREATE TABLE intrabase_audit_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES intrabase_users(id),
  method     TEXT,                    -- GET, POST, PATCH, DELETE
  path       TEXT,                    -- /api/rest/employees
  table_name TEXT,
  query_sql  TEXT,
  ip_address TEXT,
  status     INTEGER,                 -- HTTP status code
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Session store (refresh tokens)
CREATE TABLE intrabase_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES intrabase_users(id) ON DELETE CASCADE,
  refresh_token   TEXT NOT NULL UNIQUE,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

### Indexes

```sql
CREATE INDEX idx_audit_logs_user    ON intrabase_audit_logs(user_id);
CREATE INDEX idx_audit_logs_created ON intrabase_audit_logs(created_at DESC);
CREATE INDEX idx_api_keys_user      ON intrabase_api_keys(user_id);
CREATE INDEX idx_sessions_user      ON intrabase_sessions(user_id);
CREATE INDEX idx_sessions_token     ON intrabase_sessions(refresh_token);
```

---

## API Service — Directory Structure

```
services/api/src/
├── index.ts                  ← Fastify server, plugin registration
├── config/
│   └── env.ts                ← Zod-validated environment config
├── auth/
│   ├── google.ts             ← Google OAuth 2.0 flow (redirect + callback)
│   ├── jwt.ts                ← Sign, verify, refresh JWT tokens
│   └── apiKey.ts             ← API key generation, hashing, verification
├── rest/
│   ├── introspect.ts         ← PostgreSQL schema introspection
│   ├── queryBuilder.ts       ← Parse query params → SQL
│   └── routes.ts             ← Register dynamic REST routes
├── middleware/
│   ├── auth.ts               ← JWT + API key authentication middleware
│   ├── rateLimit.ts          ← Per-user rate limiting
│   └── audit.ts              ← Log every request to audit_logs
└── plugins/
    └── postgres.ts           ← PostgreSQL connection pool (via pg)
```

---

## Dashboard — Directory Structure

```
services/dashboard/src/
├── app/
│   ├── layout.tsx            ← Root layout (auth check, nav)
│   ├── page.tsx              ← Redirect to /dashboard or /login
│   ├── login/
│   │   └── page.tsx          ← Google Sign-In button
│   └── dashboard/
│       ├── layout.tsx        ← Dashboard shell (sidebar nav)
│       ├── page.tsx          ← Overview stats
│       ├── tables/
│       │   ├── page.tsx      ← Table list
│       │   └── [table]/
│       │       └── page.tsx  ← Table editor
│       ├── editor/
│       │   └── page.tsx      ← SQL editor
│       ├── users/
│       │   └── page.tsx      ← User management (admin only)
│       ├── api-keys/
│       │   └── page.tsx      ← API key management
│       └── logs/
│           └── page.tsx      ← Audit log viewer
├── components/
│   ├── TableGrid.tsx         ← Spreadsheet-like table editor
│   ├── SqlEditor.tsx         ← Monaco editor wrapper
│   ├── Sidebar.tsx           ← Navigation sidebar
│   ├── UserTable.tsx         ← User management table
│   └── ApiKeyModal.tsx       ← Create API key dialog
└── lib/
    ├── api.ts                ← Typed API client (fetch wrapper)
    ├── auth.ts               ← Auth helpers, session management
    └── types.ts              ← Shared TypeScript types
```

---

## Security Model

### Network Security

```
External ──▶ Nginx (443/80) ──▶ Internal Docker Network
                                      │
                               ┌──────┴──────┐
                               │             │
                         Dashboard(3000)  API(3001)
                               │             │
                          pgBouncer(6432)────┘
                               │
                         PostgreSQL(5432)
                         [NOT exposed externally]
```

### Auth Layers

1. **Transport** — HTTPS enforced, HTTP redirects to HTTPS
2. **Google Domain** — `ALLOWED_EMAIL_DOMAIN` env var rejects non-company emails
3. **JWT** — All API routes require valid JWT or API key in Authorization header
4. **Role check** — Admin-only routes verified at middleware level
5. **PostgreSQL RLS** — Queries run as scoped DB role, RLS policies apply at DB level

### API Key Security

- Generated as 64-char random hex string
- Only `prefix` (first 8 chars) stored in plaintext for display
- Full key bcrypt-hashed before storage
- Key shown to user ONLY once at creation time — never retrievable again

---

## Docker Compose Services

| Service | Image | Internal Port | Exposed |
|---|---|---|---|
| `postgres` | postgres:16-alpine | 5432 | No |
| `pgbouncer` | pgbouncer/pgbouncer | 6432 | No |
| `api` | intrabase/api (custom) | 3001 | No |
| `dashboard` | intrabase/dashboard (custom) | 3000 | No |
| `nginx` | nginx:alpine | 80, 443 | Yes (80, 443) |

---

## Phase 2 Additions (Post Sprint)

### Realtime Engine
- New `services/realtime/` Node.js service
- PostgreSQL `LISTEN` on `table_changes` channel
- PostgreSQL triggers fire `pg_notify('table_changes', row_to_json(NEW))` on mutations
- WebSocket server broadcasts to subscribed clients
- Client subscribes with: `{ event: "subscribe", table: "orders", filter: "status=eq.pending" }`

### File Storage
- Add MinIO container to docker-compose.yml
- New `services/storage/` service wrapping MinIO SDK
- Bucket CRUD, file upload/download/delete
- Storage browser page in dashboard
- Files served via signed URLs (time-limited)
