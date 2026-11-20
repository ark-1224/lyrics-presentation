# Lyric Presenter

Lyric presentation web app for church/event use. One operator controls everything from a
browser; two display windows (Main with video, Singers with lyrics only) stay in sync.

> Status: **step (a)** of the build is done (project setup, deployment config, health check).
> The control panel, displays, video upload and PPTX import are added in the next steps.

## Stack

Node 22 + TypeScript, Express (server), React + Vite (frontend), SQLite (from step b).
One app, one process, one Docker image.

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

More (`APP_PASSWORD`, `MAX_VIDEO_MB`) are added in later steps.

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
