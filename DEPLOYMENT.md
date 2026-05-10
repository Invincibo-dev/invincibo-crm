# Deployment Guide (CRM)

## 1) Prerequisites on Ubuntu server

- Node.js 20 LTS
- MySQL 8+
- Nginx
- PM2

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs nginx mysql-server
sudo npm i -g pm2
```

## 2) Upload project

```bash
sudo mkdir -p /var/www
cd /var/www
sudo git clone <YOUR_REPO_URL> crm
cd /var/www/crm
npm ci
cd frontend && npm ci && npm run build
```

## 3) Configure environment

```bash
cd /var/www/crm
cp .env.example .env
nano .env
```

Set secure values in `.env`:
- `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
- `JWT_SECRET` (long random secret)
- `CORS_ORIGIN`
- `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID` (if CRM follow-ups are enabled)
- `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` (if Activation Engine messages are enabled)
- `TRACKING_SECRET`, `TRACKING_BASE_URL`, `TRACKING_DEST_*`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` (if enabled)

## 4) Database schema

For a fresh production database, the official schema is:

```bash
mysql -u <DB_USER> -p < sql/production_schema.sql
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

The older SQL files are legacy references from previous phases and should not be used as the fresh production install path:

- `sql/schema.sql`
- `sql/activation_engine_tables.sql`
- `sql/phase4_alter_followups.sql`
- `sql/phase5_alter_leads_name_fields.sql`
- `sql/phase6_tags_score_dashboard.sql`
- `sql/phase7_auth_users.sql`
- `sql/phase8_audit_logs.sql`

For an existing production database, do not blindly rerun the fresh schema as a migration. Compare the live schema first and create a targeted migration.

## 5) Start backend with PM2

The runtime backend is the root app launched by `server.js`. The `legacy_src/` directory is archived legacy backend code and is not part of production runtime, tests, or deployment.

```bash
sudo mkdir -p /var/log/crm
cd /var/www/crm
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

Check logs:

```bash
pm2 logs crm-api
```

## 6) Configure Nginx

```bash
sudo cp /var/www/crm/deploy/nginx.crm.conf /etc/nginx/sites-available/crm
sudo ln -s /etc/nginx/sites-available/crm /etc/nginx/sites-enabled/crm
sudo nginx -t
sudo systemctl reload nginx
```

Optional SSL with Let's Encrypt:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d crm.your-domain.com
```

## 7) Post-deploy checks

```bash
curl -I http://crm.your-domain.com/
curl http://crm.your-domain.com/health
curl -I http://crm.your-domain.com/api/dashboard/stats
```

## 8) Update workflow

```bash
cd /var/www/crm
git pull
npm ci
cd frontend && npm ci && npm run build
cd ..
pm2 restart crm-api
```
