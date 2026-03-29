# CLAUDE.md — IntraBase Development Log

This file tracks everything being built, decisions made, and current status for IntraBase.

---

## Project Overview

**IntraBase** is an internal Supabase-like database platform for team use.
- No commercial load — internal teams only
- Google SSO authentication (Gmail) — no signup/password flow
- PostgreSQL as core database
- Auto-generated REST API from schema
- Web dashboard: table editor, SQL editor, user/role management
- Row Level Security (RLS) support
- Realtime via WebSocket + pg_notify (Phase 2)
- File storage via MinIO (Phase 2)

---

## Tech Stack Decisions

| Layer | Technology | Reason |
|---|---|---|
| Database | PostgreSQL 16 | Supabase-compatible, industry standard |
| API Backend | Node.js + Fastify + TypeScript | Fast, typed, minimal overhead |
| Auth | Google OAuth 2.0 + JWT | Internal Gmail SSO, no passwords |
| Dashboard | Next.js 14 + Tailwind CSS | SSR, modern, component-rich |
| Reverse Proxy | Nginx | SSL termination, service routing |
| Containerization | Docker + Docker Compose | Single-command deploy |
| Connection Pool | pgBouncer | Production-grade DB connections |

---

## Architecture Decisions

- Auth and REST API are merged into a single `api` service (faster to build, simpler for internal use)
- Google OAuth domain restriction: only `@<your-company>.com` emails can sign in
- JWT tokens issued after Google OAuth — all API calls require Bearer token or API key
- REST API auto-introspects PostgreSQL schema on startup — no manual route registration
- All services run inside Docker network — PostgreSQL not exposed externally

---

## Accelerated 2-3 Day Build Plan

### Day 1 — Backend Foundation
- [x] Project structure created
- [x] docker-compose.yml with PostgreSQL, pgBouncer, Nginx
- [x] .env.example with all required variables
- [x] PostgreSQL init.sql (system tables: users, api_keys, audit_logs)
- [x] API service: src/config/env.ts — Zod-validated env config
- [x] API service: src/plugins/postgres.ts — pg Pool, query helpers, transactions
- [x] API service: src/auth/jwt.ts — sign/verify access token, refresh token rotation
- [x] API service: src/auth/google.ts — Google OAuth 2.0 redirect + callback + /me + /logout
- [x] API service: src/auth/apiKey.ts — generate/hash/verify API keys + CRUD routes
- [x] API service: src/middleware/auth.ts — JWT + API key auth, role guards
- [x] API service: src/middleware/audit.ts — logs every REST/SQL call to audit_logs
- [x] API service: src/rest/introspect.ts — live schema introspection with 60s cache
- [x] API service: src/rest/queryBuilder.ts — Supabase-compatible filter/select/order/limit SQL builder
- [x] API service: src/rest/routes.ts — GET/POST/PATCH/DELETE /api/rest/:table, /api/sql, /api/users, /api/audit-logs
- [x] API service: src/index.ts — Fastify server wiring (CORS, cookies, helmet, rate-limit)

### Day 2 — Dashboard UI
- [x] next.config.js — standalone output + dev API proxy + Google image domain
- [x] tailwind.config.ts — IntraBase dark theme (background, surface, accent green)
- [x] postcss.config.js
- [x] src/app/globals.css — base styles, btn/input/card/badge/data-table utility classes
- [x] src/lib/types.ts — shared TypeScript types (AuthUser, TableInfo, Row, ApiKey, AuditLog…)
- [x] src/lib/api.ts — typed fetch client with auto token refresh + 401 redirect
- [x] src/middleware.ts — Next.js edge middleware (auth cookie guard, redirect to /login)
- [x] src/app/layout.tsx — root HTML shell
- [x] src/app/page.tsx — root redirect → /dashboard
- [x] src/app/login/page.tsx — Google Sign-In button, error messages per OAuth error code
- [x] src/app/dashboard/layout.tsx — fetches /auth/me, renders Sidebar, loading spinner
- [x] src/app/dashboard/page.tsx — overview stats (table count, column count, recent activity)
- [x] src/app/dashboard/tables/page.tsx — searchable table list with column counts
- [x] src/app/dashboard/tables/[table]/page.tsx — full table editor (search, pagination, insert/edit/delete)
- [x] src/app/dashboard/editor/page.tsx — SQL editor with examples, history, results, CSV export
- [x] src/app/dashboard/users/page.tsx — user list with role selector + activate/deactivate (admin only)
- [x] src/app/dashboard/api-keys/page.tsx — create/revoke keys, one-time key reveal with copy button
- [x] src/app/dashboard/logs/page.tsx — audit log viewer with table filter + pagination
- [x] src/components/Sidebar.tsx — nav sidebar with active state, user info, sign-out
- [x] src/components/TableGrid.tsx — spreadsheet grid: double-click edit, inline insert row, delete with confirm
- [x] src/components/SqlEditor.tsx — Monaco editor (SQL, dark theme, Ctrl+Enter to run)

### Day 3 — Security + Polish + Deploy
- [ ] RLS policy viewer/editor in dashboard
- [ ] Rate limiting on API
- [ ] HTTPS enforced via Nginx
- [ ] Allowed Gmail domain enforcement
- [ ] Final docker-compose test
- [ ] Internal deployment

---

## Environment Variables (see .env.example)

| Variable | Purpose |
|---|---|
| POSTGRES_PASSWORD | PostgreSQL root password |
| GOOGLE_CLIENT_ID | Google OAuth app client ID |
| GOOGLE_CLIENT_SECRET | Google OAuth app client secret |
| JWT_SECRET | Secret for signing JWT tokens |
| ALLOWED_EMAIL_DOMAIN | e.g. `yourcompany.com` — restrict Gmail SSO |
| DASHBOARD_URL | e.g. `https://intrabase.internal` |
| API_URL | e.g. `https://intrabase.internal/api` |

---

## File Structure

```
intrabase/
├── CLAUDE.md                  ← This file
├── README.md                  ← User-facing documentation
├── ARCHITECTURE.md            ← Technical architecture details
├── docker-compose.yml         ← All services orchestration
├── .env.example               ← Environment variable template
├── nginx/
│   ├── nginx.conf             ← Reverse proxy + SSL config
│   └── ssl/                   ← SSL certificates (gitignored)
├── postgres/
│   └── init.sql               ← Initial schema (system tables)
└── services/
    ├── api/                   ← Backend: Auth + REST API engine
    │   ├── Dockerfile
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── src/
    │       ├── index.ts       ← Fastify server entry point
    │       ├── config/        ← Env config, constants
    │       ├── auth/          ← Google OAuth + JWT logic
    │       ├── rest/          ← Auto REST engine
    │       ├── realtime/      ← WebSocket (Phase 2)
    │       └── middleware/    ← Auth, rate-limit, audit
    └── dashboard/             ← Frontend: Next.js
        ├── Dockerfile
        ├── package.json
        ├── tsconfig.json
        └── src/
            ├── app/           ← Next.js 14 app router pages
            ├── components/    ← Reusable UI components
            └── lib/           ← API client, auth helpers
```

---

## Known Constraints

- Realtime and Storage are Phase 2 (post 3-day sprint)
- Google OAuth requires a Google Cloud project with OAuth credentials configured
- For local dev without a domain, use `localhost` and HTTP (disable HTTPS in nginx.conf)
- pgBouncer is included but can be bypassed in dev (direct PostgreSQL connection)

---

## Progress Log

| Date | What was done |
|---|---|
| Day 0 | Project scaffold: folders, CLAUDE.md, README.md, ARCHITECTURE.md, package.json files, docker-compose.yml, .env.example, nginx.conf, postgres init.sql |
| Day 1 | Full API service implementation: Google OAuth SSO, JWT auth, API keys, REST engine (introspect + queryBuilder + routes), audit middleware, rate limiting |
| Day 2 | Full dashboard UI: login, table browser, table editor (grid + inline edit), SQL editor (Monaco), users, API keys, audit logs, sidebar, middleware |
