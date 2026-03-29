# IntraBase

An internal database platform for teams — similar to Supabase but self-hosted, private, and secure.

> Sign in with your company Gmail. Manage databases, run SQL, edit tables, and consume auto-generated REST APIs.

---

## Features

- **Google SSO** — Sign in with your company Gmail account, no passwords
- **Table Editor** — Spreadsheet-like UI to view, insert, update, and delete rows
- **SQL Editor** — Run raw SQL queries with syntax highlighting and result export
- **Auto REST API** — Every table in your database automatically gets REST endpoints
- **Row Level Security** — PostgreSQL RLS policies, manageable from the dashboard
- **API Keys** — Generate long-lived API keys for service-to-service calls
- **Audit Logs** — Every API call and dashboard action is logged
- **Realtime** *(Phase 2)* — Subscribe to table changes via WebSocket
- **File Storage** *(Phase 2)* — S3-compatible bucket storage via MinIO

---

## Quick Start

### Prerequisites

- Docker Desktop installed
- Google Cloud project with OAuth 2.0 credentials ([setup guide](#google-oauth-setup))
- A domain or use `localhost` for local development

### 1. Clone and configure

```bash
git clone <your-internal-repo>/intrabase
cd intrabase
cp .env.example .env
```

Edit `.env` and fill in all required values (see [Environment Variables](#environment-variables)).

### 2. Start everything

```bash
docker compose up -d
```

This starts:
- PostgreSQL 16 on internal port 5432
- pgBouncer (connection pooler) on internal port 6432
- IntraBase API on internal port 3001
- IntraBase Dashboard on internal port 3000
- Nginx reverse proxy on ports 80 and 443

### 3. Access

Open `https://intrabase.internal` (or `http://localhost` for local dev) and sign in with your company Gmail.

---

## Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or use existing)
3. Navigate to **APIs & Services → Credentials**
4. Click **Create Credentials → OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Add authorized redirect URI:
   - Production: `https://intrabase.internal/api/auth/google/callback`
   - Local dev: `http://localhost:3001/api/auth/google/callback`
7. Copy **Client ID** and **Client Secret** into your `.env` file

---

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Description | Example |
|---|---|---|
| `POSTGRES_PASSWORD` | PostgreSQL root password | `supersecretpassword` |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID | `123456.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Client Secret | `GOCSPX-...` |
| `JWT_SECRET` | Secret for signing JWT tokens (min 32 chars) | `your-very-long-random-secret` |
| `ALLOWED_EMAIL_DOMAIN` | Restrict sign-in to this Gmail domain | `yourcompany.com` |
| `DASHBOARD_URL` | Public URL of dashboard | `https://intrabase.internal` |
| `API_URL` | Public URL of API | `https://intrabase.internal/api` |
| `NODE_ENV` | Environment | `production` |

---

## Using the REST API

Every table automatically gets these endpoints:

```bash
# List rows (with filters, pagination, ordering)
GET /api/rest/{table}?select=col1,col2&col=eq.value&limit=10&order=created_at.desc

# Insert a row
POST /api/rest/{table}
Content-Type: application/json
{ "column": "value" }

# Update rows matching filter
PATCH /api/rest/{table}?id=eq.123
{ "column": "new_value" }

# Delete rows matching filter
DELETE /api/rest/{table}?id=eq.123
```

### Authentication

All API calls require one of:
- `Authorization: Bearer <jwt_token>` — from Google SSO login
- `Authorization: Bearer <api_key>` — from API Keys page in dashboard

### Filter operators (same as Supabase)

| Operator | Meaning | Example |
|---|---|---|
| `eq` | equals | `?status=eq.active` |
| `neq` | not equals | `?status=neq.deleted` |
| `gt` | greater than | `?age=gt.18` |
| `gte` | greater than or equal | `?age=gte.18` |
| `lt` | less than | `?price=lt.100` |
| `lte` | less than or equal | `?price=lte.100` |
| `like` | SQL LIKE | `?name=like.%john%` |
| `ilike` | case-insensitive LIKE | `?name=ilike.%john%` |
| `in` | IN list | `?id=in.(1,2,3)` |
| `is` | IS NULL/TRUE/FALSE | `?deleted_at=is.null` |

---

## Roles & Permissions

| Role | Capabilities |
|---|---|
| `admin` | Full access — manage users, roles, RLS policies, all tables |
| `editor` | Read + write on assigned tables, run SQL, use API |
| `viewer` | Read-only on assigned tables |

Roles are assigned from the **Users** page in the dashboard (admin only).

---

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full technical architecture.

---

## Development

### Local development without Docker

```bash
# API service
cd services/api
npm install
npm run dev

# Dashboard
cd services/dashboard
npm install
npm run dev
```

Requires a local PostgreSQL instance. Set `DATABASE_URL` in your `.env`.

### Running with Docker (recommended)

```bash
docker compose up --build
```

### Viewing logs

```bash
docker compose logs -f api
docker compose logs -f dashboard
docker compose logs -f postgres
```

---

## Roadmap

- [x] Google SSO authentication
- [x] Auto REST API from PostgreSQL schema
- [x] Table editor UI
- [x] SQL editor UI
- [x] User & role management
- [x] API key management
- [x] Audit logs
- [ ] Realtime subscriptions (WebSocket)
- [ ] File storage (MinIO)
- [ ] Schema migration UI
- [ ] Table relationships visualizer (ERD)
- [ ] Scheduled SQL jobs

---

## Security

- All traffic over HTTPS (Nginx + SSL)
- PostgreSQL not exposed outside Docker network
- Google OAuth domain restriction — only `@yourcompany.com` can sign in
- JWT tokens expire in 8 hours, refresh tokens in 7 days
- API keys are hashed in database (never stored in plaintext)
- Rate limiting: 100 req/min per user on REST API
- All actions logged to audit_logs table

---

## Support

For issues or feature requests, contact your internal platform team or open a ticket in your internal issue tracker.
