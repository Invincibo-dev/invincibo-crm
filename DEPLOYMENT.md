# Hostinger Production Deployment

This project is deployed as two separate production surfaces:

- Backend API: `https://api.cv-pam.com`
- Frontend React app: `https://cv-pam.com`

The runtime backend is the root Node/Express app launched by `server.js`. The `legacy_src/` directory is archived legacy backend code and is not part of runtime, tests, or deployment.

Use Node.js `22.x` on Hostinger. The project declares `node >=22.12.0 <25` because the frontend build uses Vite 8, which requires Node `^20.19.0` or `>=22.12.0`. Hostinger currently supports Node.js `18.x`, `20.x`, `22.x`, and `24.x`; choose `22.x` unless you intentionally validate on `24.x`.

## 1) Repository Layout

Required production files:

- `server.js`, `app.js`, `routes/`, `controllers/`, `services/`, `models/`
- `frontend/`
- `sql/production_schema.sql`
- `DEPLOYMENT.md`
- `tests/`
- `legacy_src/` as archive only

Do not deploy local-only files:

- `.env`
- `node_modules/`
- `frontend/node_modules/`
- `frontend/dist/` unless uploading the built static frontend separately
- logs, coverage, SQLite databases, temporary files

## 2) Backend Subdomain

In Hostinger, create the backend subdomain:

```text
api.cv-pam.com
```

Point it to the Node.js backend application. The backend must run from the repository root and start with:

```bash
npm start
```

The start script launches:

```bash
node server.js
```

The server listens on `process.env.PORT`.

## 3) Backend Install

On the backend app directory:

```bash
npm ci --omit=dev
```

For validation before production, install dev dependencies locally or in a staging shell:

```bash
npm ci
npm test -- --runInBand
```

## 4) Backend Environment

Create the backend `.env` on Hostinger from `.env.example`. Never commit `.env`.

A Hostinger-specific backend template is available at:

```text
deploy/backend.env.hostinger.example
```

Minimum production values:

```bash
NODE_ENV=production
PORT=<hostinger_node_port>
CORS_ORIGIN=https://cv-pam.com
JWT_SECRET=<long_random_secret>
JWT_EXPIRES_IN=8h
ADMIN_BOOTSTRAP_TOKEN=<one_time_random_secret>

DB_DIALECT=mysql
DB_HOST=<hostinger_mysql_host>
DB_PORT=3306
DB_NAME=crm_db
DB_USER=<hostinger_mysql_user>
DB_PASSWORD=<hostinger_mysql_password>
DB_AUTO_SYNC=false

TRACKING_BASE_URL=https://api.cv-pam.com
TRACKING_SECRET=<long_random_tracking_secret>
TRACKING_TOKEN_TTL_SECONDS=2592000
TRACKING_DEST_ACTIVATION=https://cv-pam.com/activation
TRACKING_DEST_ONBOARDING=https://cv-pam.com/onboarding
TRACKING_DEST_PAYMENT=https://cv-pam.com/payment
TRACKING_DEST_DEFAULT=https://cv-pam.com

WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_COOLDOWN_HOURS=6
FOLLOWUP_CRON_ENABLED=false
WHATSAPP_FOLLOWUP_MAX_ATTEMPTS=3
```

The first `POST /api/auth/register` request must create an `admin` and include
`x-admin-bootstrap-token: <ADMIN_BOOTSTRAP_TOKEN>`. After that account is created,
remove `ADMIN_BOOTSTRAP_TOKEN` from the environment and restart the API. Every
later user creation requires an authenticated administrator.

Optional variables are documented in `.env.example`.

Use `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` for production WhatsApp sending. They can stay empty for the first backend launch if `FOLLOWUP_CRON_ENABLED=false`, but lead creation or group messaging that attempts to send WhatsApp messages will fail until valid values are configured. The backend still accepts the older local aliases `WHATSAPP_TOKEN` and `PHONE_NUMBER_ID` as fallbacks, but they should not be used for the Hostinger environment.

Set `FOLLOWUP_CRON_ENABLED=true` only after the follow-up automation has been validated in production. When enabled, the backend will run the scheduled follow-up processor from the Node.js process.

On startup with `NODE_ENV=production`, the backend validates required production settings before connecting to MySQL. It exits if required values are missing, still set to placeholders, if `DB_AUTO_SYNC=true`, if `DB_DIALECT` is not `mysql`, or if `CORS_ORIGIN=*`. WhatsApp credentials are required at startup only when `FOLLOWUP_CRON_ENABLED=true`.

Security expectations:

- `CORS_ORIGIN` must be `https://cv-pam.com` in production.
- Do not use `*` for CORS.
- Generate new production values for `JWT_SECRET` and `TRACKING_SECRET`.
- Rotate WhatsApp tokens if they were ever used in a local file.
- Keep `DB_AUTO_SYNC=false` or unset in production. Use SQL schema import instead.

## 5) MySQL Schema

For a fresh production database, the official schema is:

```text
sql/production_schema.sql
```

Import it into Hostinger MySQL:

```bash
mysql -h <DB_HOST> -u <DB_USER> -p < sql/production_schema.sql
```

If importing through Hostinger phpMyAdmin, use this Hostinger-safe variant instead:

```text
sql/hostinger_production_schema.sql
```

This file does not contain `CREATE DATABASE` or `USE crm_db` because Hostinger MySQL users usually cannot create databases from phpMyAdmin. Create the database from the Hostinger panel first, open that database in phpMyAdmin, then import `sql/hostinger_production_schema.sql`.

`sql/production_schema.sql` creates `crm_db` and all tables required by the real root backend:

- `users`
- `leads`
- `messages`
- `followups`
- `tags`
- `lead_tags`
- `audit_logs`
- `student`
- `tasks`
- `student_action`
- `tracking_event`

Legacy SQL files are references only and are not the fresh production install path:

- `sql/schema.sql`
- `sql/activation_engine_tables.sql`
- `sql/phase4_alter_followups.sql`
- `sql/phase5_alter_leads_name_fields.sql`
- `sql/phase6_tags_score_dashboard.sql`
- `sql/phase7_auth_users.sql`
- `sql/phase8_audit_logs.sql`

For an existing production DB, do not rerun the fresh schema blindly. Compare first and write a targeted migration.

For the critical-stabilization release, apply
`sql/phase9_critical_stabilization.sql` once before starting the new backend.
Follow-ups now use `pending -> processing -> completed` delivery states. An
ambiguous network result remains `processing` and must be reconciled with the
WhatsApp provider before any manual retry; this prevents automatic duplicates.

After the phase 9 prerequisite, all current and future schema changes are applied
through the versioned runner:

```bash
npm run db:migrate
npm run db:migrate:status
```

Run migrations after creating a verified backup and before starting the new API
process. See `DATABASE.md` for the schema map, pagination contract, backup, and
restore-validation procedure.

## 6) Frontend Domain

In Hostinger, configure:

```text
cv-pam.com
```

as a static website serving the React build output from:

```text
frontend/dist
```

Create `frontend/.env.production` locally or in the Hostinger build environment:

```bash
VITE_API_BASE_URL=https://api.cv-pam.com/api
VITE_TRACKING_BASE_URL=https://api.cv-pam.com
```

A copy-safe template is available at:

```text
deploy/frontend.env.production.example
```

Do not commit `frontend/.env.production` if it ever contains environment-specific values.

Build frontend:

```bash
cd frontend
npm ci
npm run build
```

Upload or serve the contents of:

```text
frontend/dist/
```

for `https://cv-pam.com`.

## 7) API Routing Contract

Backend routes:

- `/health`
- `/t/:token`
- `/api/auth/*`
- `/api/leads/*`
- `/api/followups/*`
- `/api/tags/*`
- `/api/dashboard/*`
- `/api/activation/*`

The frontend Axios client uses:

```bash
VITE_API_BASE_URL=https://api.cv-pam.com/api
```

and sends JWT auth as:

```text
Authorization: Bearer <token>
```

Tracking links are generated from:

```bash
TRACKING_BASE_URL=https://api.cv-pam.com
```

so public tracking redirects use:

```text
https://api.cv-pam.com/t/:token
```

## 8) Follow-up Cron

The CRM follow-up automation is controlled by:

```bash
FOLLOWUP_CRON_ENABLED=false
```

Operational rule:

- Keep `FOLLOWUP_CRON_ENABLED=false` for the first backend deployment.
- Validate login, lead creation, WhatsApp credentials, and manual processing first.
- Enable `FOLLOWUP_CRON_ENABLED=true` only when automatic follow-up sending is ready.
- Run exactly one backend Node.js process with the cron enabled. If multiple app instances run with `FOLLOWUP_CRON_ENABLED=true`, each instance can execute the same scheduler every 5 minutes.
- Keep Hostinger/PM2 process count at one instance unless the cron is moved to a separate worker process.

When enabled, `server.js` starts `jobs/followupCron.js` after a successful database connection. The scheduler runs every 5 minutes and calls the same processor used by the admin endpoint:

```text
POST /api/followups/process
```

Manual validation before enabling the cron:

```bash
curl -X POST https://api.cv-pam.com/api/followups/process \
  -H "Authorization: Bearer <admin_jwt>"
```

Expected: JSON response with `result.total`, `result.sent`, `result.failed`, and `result.skipped`.

Required before setting `FOLLOWUP_CRON_ENABLED=true`:

- `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` are valid.
- Production MySQL schema has `followups`, `leads`, and `messages`.
- At least one pending follow-up exists with `scheduled_date <= NOW()`.
- Backend logs are accessible for `[Cron] Follow-up processor result` and `[Cron] Follow-up processor error`.

## 9) Production Checks

Backend health:

```bash
curl https://api.cv-pam.com/health
```

Expected:

```json
{ "status": "ok" }
```

Login API:

```bash
curl -X POST https://api.cv-pam.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<admin_email>","password":"<admin_password>"}'
```

Frontend to backend:

1. Open `https://cv-pam.com`.
2. Login with a real production user.
3. Confirm dashboard data loads without CORS errors.
4. Confirm protected requests include `Authorization: Bearer <token>`.

Tracking:

```bash
curl -I "https://api.cv-pam.com/t/<token>"
```

Expected: HTTP redirect to the configured `TRACKING_DEST_*` URL.

Follow-up processor:

```bash
curl -X POST https://api.cv-pam.com/api/followups/process \
  -H "Authorization: Bearer <admin_jwt>"
```

Expected: JSON summary of processed pending follow-ups. Run this manually before enabling `FOLLOWUP_CRON_ENABLED=true`.

## 10) Local Development

Local frontend:

```bash
cd frontend
npm run dev
```

Local backend:

```bash
npm run dev
```

For local dev, use:

```bash
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173
TRACKING_BASE_URL=http://localhost:5000
```

The backend CORS default is strict:

- production default: `https://cv-pam.com`
- development default: `http://localhost:5173`

## 11) Update Workflow

Backend:

```bash
git pull
npm ci --omit=dev
npm start
```

Frontend:

```bash
git pull
cd frontend
npm ci
npm run build
```

Then upload or serve the new `frontend/dist/` contents.

## 12) Hostinger Final Checklist

Runtime:

- Select Node.js `22.x` for the backend app in Hostinger.
- Confirm `npm --version` is `>=10`.
- Backend app root points to the repository root.
- Backend start command is `npm start`.
- Backend entry point is `server.js`.

MySQL:

- Create the Hostinger MySQL database and user.
- Import `sql/production_schema.sql` for a fresh install.
- Confirm the production `.env` uses the exact Hostinger DB host, database name, user, and password.
- Keep `DB_AUTO_SYNC=false`.

Backend environment:

- Use `deploy/backend.env.hostinger.example` as the checklist.
- Replace all `<...>` placeholders before starting the app.
- Generate fresh `JWT_SECRET` and `TRACKING_SECRET`.
- Set `CORS_ORIGIN=https://cv-pam.com`.
- Set `TRACKING_BASE_URL=https://api.cv-pam.com`.
- Leave WhatsApp values empty only for the first launch with `FOLLOWUP_CRON_ENABLED=false`.
- Keep `FOLLOWUP_CRON_ENABLED=false` for the first launch.

Frontend:

- Create `frontend/.env.production` from `deploy/frontend.env.production.example`.
- Run `cd frontend && npm ci && npm run build`.
- Upload or serve the contents of `frontend/dist/` for `https://cv-pam.com`.
- Confirm SPA fallback routes unknown paths to `index.html`.

Go-live checks:

- `curl https://api.cv-pam.com/health` returns `{"status":"ok"}`.
- Login works from `https://cv-pam.com`.
- Browser network requests go to `https://api.cv-pam.com/api`.
- No CORS errors appear in the browser console.
- Manual `POST /api/followups/process` works before enabling the cron.
