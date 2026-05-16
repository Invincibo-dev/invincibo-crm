# Hostinger Production Deployment

This project is deployed as two separate production surfaces:

- Backend API: `https://api.cv-pam.com`
- Frontend React app: `https://cv-pam.com`

The runtime backend is the root Node/Express app launched by `server.js`. The `legacy_src/` directory is archived legacy backend code and is not part of runtime, tests, or deployment.

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

Minimum production values:

```bash
NODE_ENV=production
PORT=<hostinger_node_port>
CORS_ORIGIN=https://cv-pam.com
JWT_SECRET=<long_random_secret>
JWT_EXPIRES_IN=8h

DB_DIALECT=mysql
DB_HOST=<hostinger_mysql_host>
DB_PORT=3306
DB_NAME=crm_db
DB_USER=<hostinger_mysql_user>
DB_PASSWORD=<hostinger_mysql_password>

TRACKING_BASE_URL=https://api.cv-pam.com
TRACKING_SECRET=<long_random_tracking_secret>
TRACKING_DEST_ACTIVATION=https://cv-pam.com/activation
TRACKING_DEST_ONBOARDING=https://cv-pam.com/onboarding
TRACKING_DEST_PAYMENT=https://cv-pam.com/payment
TRACKING_DEST_DEFAULT=https://cv-pam.com

WHATSAPP_ACCESS_TOKEN=<whatsapp_cloud_api_token>
WHATSAPP_PHONE_NUMBER_ID=<whatsapp_phone_number_id>
WHATSAPP_COOLDOWN_HOURS=6
```

Optional variables are documented in `.env.example`.

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

## 8) Production Checks

Backend health:

```bash
curl https://api.cv-pam.com/health
```

Expected:

```json
{"status":"ok"}
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

## 9) Local Development

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

## 10) Update Workflow

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
