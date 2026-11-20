# Lyric Presenter

Lyric presentation web app for church/event use. One operator controls everything from a
browser; two display windows (Main with video, Singers with lyrics only) stay in sync.

> Status: steps **(a)** setup/deploy/health check and **(b)** control panel with presentations
> and slides are done. Live displays, video upload/styling and PPTX import come next.

## Stack

Node 22 + TypeScript, Express (server), React + Vite (frontend), SQLite via `better-sqlite3`.
One app, one process, one Docker image.

## What works now

Open `/control` to create, rename, duplicate and delete presentations, and to add, edit,
drag-reorder and delete slides (lyrics plus private notes). Edits autosave. Data lives in
`DATA_DIR/app.db`.

## Turning on the password

By default the app is open, which is fine on your own laptop. For a public Railway URL, set the
`APP_PASSWORD` environment variable (Railway: service **Variables** tab → add `APP_PASSWORD`).
The control panel then asks for it, and every API call except `/healthz` is refused without it.
The login is remembered for 30 days in that browser. Changing the password signs everyone out.
Leave `APP_PASSWORD` unset locally to run without a login.

## Run locally

```bash
npm install
cp .env.example .env     # optional; defaults work
npm run dev              # server on :3000, Vite dev client on :5173
```

Open http://localhost:5173 in dev. For a production-style run:

```bash
npm run build
npm start                # everything on http://localhost:3000
```

Other scripts: `npm run lint`, `npm test`, `npm run typecheck`.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on. Railway sets this automatically. |
| `DATA_DIR` | `RAILWAY_VOLUME_MOUNT_PATH`, else `./data` | Where the database and uploaded videos live. |

| `APP_PASSWORD` | unset (open) | Optional shared password for the control panel and API. |

`MAX_VIDEO_MB` is added with video upload in step (d).

## Health check

`GET /healthz` returns `200 {"status":"ok",...}` when the data folder is writable, and `503`
otherwise. Railway uses it to decide whether a deploy is healthy (configured in `railway.json`).

## Deploy to Railway (summary, full checklist comes at the end)

1. Push this repo to GitHub (branch `main`).
2. In Railway: **New Project → Deploy from GitHub repo** and pick the repo. `railway.json`
   tells Railway to build the `Dockerfile` and use `/healthz` as the health check.
3. Add a **Volume** to the service and mount it at `/data`. Railway then provides
   `RAILWAY_VOLUME_MOUNT_PATH=/data` and the app uses it automatically. Without a volume the app
   logs a warning, because data would be lost on each redeploy.
4. Under **Settings → Networking**, generate a public domain.

No secrets are committed. Copy `.env.example` to `.env` for local use only.
