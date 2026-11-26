# Lyric Presenter

Lyric presentation web app for church/event use. One operator controls everything from a
browser; two display windows (Main with video, Singers with lyrics only) stay in sync.

> Status: all five build steps are done: **(a)** setup/deploy/health check, **(b)** control panel,
> **(c)** real-time sync with the two displays, **(d)** video manager + styling controls, and
> **(e)** PowerPoint import. The full Railway checklist and final summary are still to come.

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
2. In the control panel pick a presentation and click **Go live**, or click **â–¶ Show** on any slide.
   Once it is live, the **Jump to slide** list in the Live panel shows every slide with its first line:
   click any one to go straight there, in any order (slide 1 to slide 5, then back to slide 2, and so on).
   **Sections:** on the Slides tab, give a slide a section (Verse, Chorus, Bridge, plus Intro, Pre-chorus, Tag,
   Outro) with the dropdown on its card, or pick **Custom name…** to type your own (for example Refrain).
   A custom name is set on that slide only; **Rename** changes it on every slide of the song that uses it.
   The Live panel then shows one button per section used in the song:
   press **Chorus** to jump to the next chorus after the current slide (pressing again goes to the one after,
   then wraps around), **Bridge** for the bridge, and so on.
3. Run the show with **Next / Previous / Blank**, or the keyboard: **â†’ â†“ Space** next, **â† â†‘**
   previous, **B** blank. Shortcuts pause while you are typing in a text box (press **Esc** to leave it).

How it works: the server keeps the one true state (which presentation, which slide, blank on/off,
styling) and pushes it to every window over a WebSocket at `/ws`. A display that refreshes or joins
late gets the full state immediately; if its connection drops it keeps showing the last slide and
reconnects by itself. Private notes are never sent to the display windows.

## Importing from PowerPoint

Click **Import PowerPoint (.pptx)â€¦** under the presentation list and pick a file. You get a review
screen before anything is saved:

- every slide becomes one lyric slide, in slideshow order; the slide's text is the lyrics and its
  speaker notes become the private notes;
- only text and notes are read. Pictures, shapes, animations and styling are ignored, as are slide
  numbers, dates and footers;
- slides with no text are listed as **Empty** and unticked (skipped) by default; slides hidden in
  PowerPoint are flagged **Hidden**. Tick or untick any slide, edit any text, and rename the
  presentation, then click **Import**. Cancel creates nothing.

Not supported: old binary `.ppt` files and password-protected files (the message tells you to
re-save as `.pptx` in PowerPoint). Files over 50 MB, over 500 slides, or that expand to an
unreasonable size are refused.

## Styling and videos

The control panel has three tabs next to the presentation list:

- **Slides**: edit lyrics and private notes, drag to reorder, **â–¶ Show** to put a slide on screen.
- **Style**: per presentation, separately for the Main and Singers displays: font, text size, text
  color, alignment, vertical position, and outline/shadow strength (to keep text readable over a
  bright video). Singers also has a background color (default black). Every change shows in a
  preview right away and reaches the live displays a moment later; there is no Save button.
  Text size is a percentage of the screen height, so it looks the same at 1080p and 4K.
  The Main preview shows the chosen video's first frame (paused) so you can judge readability.
- **Videos**: the shared library of background videos. Upload (mp4 or webm, up to `MAX_VIDEO_MB`,
  with a progress bar and Cancel), preview, rename, and delete. Deleting asks first and warns if
  presentations use the video or it is on the Main display right now; those presentations then go
  back to no video. Files are stored in `DATA_DIR/videos` and checked on upload (type and contents).

## Turning on the password

By default the app is open, which is fine on your own laptop. For a public Railway URL, set the
`APP_PASSWORD` environment variable (Railway: service **Variables** tab â†’ add `APP_PASSWORD`).
The control panel then asks for it, and every API call except `/healthz` is refused without it.
The login is remembered for 30 days in that browser. Changing the password signs everyone out.
Leave `APP_PASSWORD` unset locally to run without a login.

## Run locally

```bash
npm install
npm run dev              # server on :3000, Vite dev client on :5173 (the defaults work as they are)
```

Open http://localhost:5173 in dev. For a production-style run:

```bash
npm run build
npm start                # everything on http://localhost:3000
```

Other scripts: `npm run lint`, `npm test`, `npm run typecheck`, and `npm run fixtures` (rebuilds the
sample PowerPoint file `tests/fixtures/sample.pptx` used by the parser tests).

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on. Railway sets this automatically. |
| `DATA_DIR` | `RAILWAY_VOLUME_MOUNT_PATH`, else `./data` | Where the database and uploaded videos live. |
| `APP_PASSWORD` | unset (open) | Optional shared password for the control panel and API. |
| `MAX_VIDEO_MB` | `500` | Largest background video you can upload, in megabytes. |

To change a setting locally, create a `.env` file in the project folder with one `NAME=value` per
line (for example `APP_PASSWORD=mypassword`). `npm run dev` reads it automatically, and git ignores
it. `npm start` does not read `.env`, so set the variables in your terminal instead.

The two display pages and the video files (`/media/...`) are always open, because the TV windows
need them without logging in. They only show what is on screen, and cannot change anything.

## Health check

`GET /healthz` returns `200 {"status":"ok",...}` when the data folder is writable, and `503`
otherwise. Railway uses it to decide whether a deploy is healthy (configured in `railway.json`).

## Deploy to Railway (summary, full checklist comes at the end)

1. Push this repo to GitHub (branch `main`).
2. In Railway: **New Project â†’ Deploy from GitHub repo** and pick the repo. `railway.json`
   tells Railway to build the `Dockerfile` and use `/healthz` as the health check.
3. Add a **Volume** to the service and mount it at `/data`. Railway then provides
   `RAILWAY_VOLUME_MOUNT_PATH=/data` and the app uses it automatically. Without a volume the app
   logs a warning, because data would be lost on each redeploy.
4. Under **Settings â†’ Networking**, generate a public domain.

No secrets are committed. Set variables such as `APP_PASSWORD` in Railway's **Variables** tab, not in the repo.
