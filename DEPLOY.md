# Deploying ProsParity for free

| Part | Service | Free tier (check current terms) | Why |
|---|---|---|---|
| Frontend (React/Vite) | **Vercel** Hobby | static hosting, global CDN, HTTPS | zero-config Vite builds, deploy on every push |
| Backend (FastAPI) | **Render** free web service | 512 MB RAM, 750 instance-hours/month, **sleeps after 15 min idle** (~1 min to wake) | runs the existing Dockerfile unchanged, no card needed |
| Database (MySQL) | **TiDB Cloud Starter** | free monthly storage + request-unit quota, scales to zero | MySQL-compatible, so the app, migrations and tests need no changes (Aiven's free MySQL and PlanetScale's free tier are gone) |

```
Browser ──► Vercel (static SPA) ──VITE_API_URL──► Render (FastAPI, Docker) ──TLS──► TiDB Cloud (MySQL :4000)
```

## 0. Put the code on GitHub

Vercel and Render deploy from a Git repo. `storage/` (which holds `dev.db` with real employee data) and every
`.env` file are git-ignored. Keep it that way.

```bash
cd HR-dashboard
git init && git add . && git commit -m "ProsParity"
# create an empty PRIVATE repo on github.com, then:
git remote add origin git@github.com:<you>/prosparity.git
git branch -M main && git push -u origin main
```

## 1. Database: TiDB Cloud Starter

1. Sign up at <https://tidbcloud.com> → **Create cluster** → **Starter** → region **AWS Singapore**
   (or Mumbai if offered) → create.
2. Cluster → **Connect** → connection type **Public**, "Connect with: **General**" → **Generate password**.
   Note the host (`gateway01.<region>.prod.aws.tidbcloud.com`), port `4000` and user (`<prefix>.root`).
3. Cluster → **SQL Editor**: `CREATE DATABASE prosparity;`
4. Build the URL (URL-encode special characters in the password, e.g. `@` → `%40`, `#` → `%23`):

   ```
   mysql+pymysql://<prefix>.root:<password>@gateway01.<region>.prod.aws.tidbcloud.com:4000/prosparity?charset=utf8mb4
   ```

5. Create the schema and copy your current local data in, **from your laptop**:

   ```bash
   cd backend
   export DATABASE_URL='mysql+pymysql://…/prosparity?charset=utf8mb4'
   export DB_SSL=true
   .venv/bin/alembic upgrade head
   .venv/bin/python -m app.copy_db --source sqlite:///./storage/dev.db
   unset DATABASE_URL DB_SSL
   ```

   `copy_db` keeps all ids and refuses to write into a non-empty database (`--wipe` replaces its contents).
   Instead of copying you can load the legacy sheets (`python -m app.importers.load_legacy --reset …`) or demo
   data (`python -m app.seed`) with the same two env vars set.

## 2. Backend: Render

1. <https://render.com> → sign in with GitHub → **New → Blueprint** → pick the repo. Render reads `render.yaml`.
2. Fill the prompted values:
   * `DATABASE_URL`: the URL from step 1.4
   * `CORS_ORIGINS` and `FRONTEND_URL`: put `https://example.com` for now. You'll set the real Vercel URL in step 4.
   `JWT_SECRET` is generated automatically.
3. Deploy. On start the container waits for the DB, runs `alembic upgrade head`, then starts uvicorn on `$PORT`.
4. Check `https://<service>.onrender.com/api/health` → `{"status":"ok",…}`. API docs are at `/docs`.

## 3. Frontend: Vercel

1. <https://vercel.com> → sign in with GitHub → **Add New → Project** → import the repo.
2. **Root Directory: `frontend`**. The framework (Vite) and build settings come from `frontend/vercel.json`.
3. **Environment Variables:** `VITE_API_URL` = `https://<service>.onrender.com` (no trailing slash).
4. Deploy → you get `https://<project>.vercel.app`.

## 4. Connect them

In Render → service → **Environment**, set `CORS_ORIGINS` and `FRONTEND_URL` to the exact Vercel URL
(e.g. `https://prosparity.vercel.app`). Render redeploys automatically. Then open the Vercel URL and sign in.

Optional: to let Vercel **preview** deployments call the API too, also set
`CORS_ORIGIN_REGEX=https://<project>-[a-z0-9-]+-<team>\.vercel\.app`.

> `VITE_API_URL` is compiled into the bundle. If you change it in Vercel, redeploy the frontend.

## 5. Keep the backend awake (recommended)

Render's free service sleeps after 15 minutes without traffic. The first request after that waits about a minute,
and the nightly 00:30 IST job (cycle creation, accrual recalculation, probation alerts) only runs while it's awake.
One service running 24/7 is ~720 h, inside the 750 free hours.

* <https://cron-job.org> (free) → new job → URL `https://<service>.onrender.com/api/health` → every 10 minutes.

## 6. After going live

* **Change the HR password** (Settings → Users & roles, or the profile menu). The seeded/legacy-loaded login is `shraddha@prosparity.in` unless you already changed it.
* **Email to Accounts:** add SMTP details in **Settings** (e.g. Gmail with an app password, or Brevo's free SMTP).
  Without SMTP the app only "logs" emails to the container disk.
* **Updates:** `git push` → Render and Vercel both redeploy. New Alembic migrations run automatically on boot.

## Free-tier limitations to know

* **Disk on Render is temporary.** Uploaded import files, generated report files and leave attachments are lost on
  every restart/redeploy. Everything in the database is safe. Imports only need their file for the few minutes of
  the wizard; re-download reports any time. If leave attachments must persist, move them to object storage
  (e.g. Cloudflare R2's free tier).
* **Cold starts** (see step 5) and 512 MB RAM. Very large Excel imports may be slow.
* **Backups:** TiDB Starter has limited automated backups. Export important data regularly
  (`mysqldump` works against TiDB, or keep a copy with `app.copy_db --source <tidb-url>` into a local SQLite file).

## Environment variables reference (backend)

| Variable | Production value |
|---|---|
| `ENVIRONMENT` | `production` (refuses to start with a default/short `JWT_SECRET`) |
| `DATABASE_URL` | TiDB URL (see above) |
| `DB_SSL` | `true` (TLS verified against the public CA bundle; `DB_SSL_CA=/path/ca.pem` for a custom CA) |
| `DB_POOL_SIZE` / `DB_MAX_OVERFLOW` | `5` / `5` (defaults) |
| `JWT_SECRET` | random, ≥ 32 chars (Render generates it) |
| `CORS_ORIGINS`, `FRONTEND_URL` | your Vercel URL |
| `CORS_ORIGIN_REGEX` | optional, for preview URLs |
| `BUSINESS_TIMEZONE` | `Asia/Kolkata` |
| `ENABLE_SCHEDULER` | `true` |
| `SEED_DEMO` | `false` (`true` seeds demo data on an empty DB) |
