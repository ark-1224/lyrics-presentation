# Lyric Presenter

Lyric presentation web app for church/event use. One operator controls everything from a
browser; two display windows (Main with video, Singers with lyrics only) stay in sync.

> Status: steps **(a)** setup/deploy/health check, **(b)** control panel with presentations and
> slides, and **(c)** real-time sync with the two displays are done. The full video manager,
> styling controls and PPTX import come next.

## Stack

Node 22 + TypeScript, Express (server), React + Vite (frontend), SQLite via `better-sqlite3`.
One app, one process, one Docker image.

## What works now

Open `/control` to create, rename, duplicate and delete presentations, and to add, edit,
drag-reorder and delete slides (lyrics plus private notes). Edits autosave. Data lives in
`DATA_DIR/app.db`.

## Running a service (live sync)

1. Open `/control` on the laptop. Open `/display/main` and `/display/singers` in two more
   browser windows, drag each onto its own TV (extended display) and click **Click to start** in
   each (that click is what lets the browser go fullscreen). The control panel shows a green
   light for each connected display.
2. In the control panel pick a presentation and click **Go live**, or click **▶ Show** on any slide.
3. Run the show with **Next / Previous / Blank**, or the keyboard: **→ ↓ Space** next, **← ↑**
   previous, **B** blank. Shortcuts pause while you are typing in a text box (press **Esc** to leave it).

How it works: the server keeps the one true state (which presentation, which slide, blank on/off,
styling) and pushes it to every window over a WebSocket at `/ws`. A display that refreshes or joins
late gets the full state immediately; if its connection drops it keeps showing the last slide and
reconnects by itself. Private notes are never sent to the display windows.

Background video: pick one in the editor (or **Upload video…**, mp4/webm up to `MAX_VIDEO_MB`).
Videos are stored in `DATA_DIR/videos`. The Main display shows it looping and muted behind the text.
The small Main preview in the control panel does not play the video, to save CPU.

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
| `MAX_VIDEO_MB` | `500` | Largest background video you can upload, in megabytes. |

The two display pages and the video files (`/media/...`) are always open, because the TV windows
need them without logging in. They only show what is on screen, and cannot change anything.

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
