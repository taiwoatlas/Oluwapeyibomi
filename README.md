# Oluwapeyibomi — backend

This is the backend for the site. It gives you:

1. **Working forms** — the waitlist, connect, and ask-a-question forms save every
   submission to a real database, and can optionally email you when one comes in.
2. **An admin panel** at `/admin` — a private page where you can read submissions,
   add/edit/delete archive photos, choose which ones are "featured" on the archive
   page, and connect a live Instagram feed.
3. **A live Instagram feed** on the archive page.

It has **zero npm dependencies** — it only uses what's already built into Node.js
(including Node's built-in SQLite database), so there's nothing to `npm install`.
You do need a reasonably recent Node — version 22.5 or later.

## 1. Run it locally

```bash
cd backend
cp .env.example .env
npm run hash-password       # choose an admin password, paste the printed hash into .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # paste into .env as SESSION_SECRET
npm start
```

Then open:
- **http://localhost:3000/** — the website itself (this server serves it directly,
  reading from `../oluwapeyibomi-website`)
- **http://localhost:3000/admin/** — the admin panel, log in with the password you chose

The very first time it runs, it imports the 54 existing archive photos and marks
the same 9 that are currently featured, so nothing changes until you edit something
in `/admin`.

## 2. What each form does now

Previously, submitting a form just showed a fake "you're in" message and nothing was
saved anywhere. Now:

- Every submission is saved to `data/app.db` (a SQLite file) — visible under the
  **Inbox** tab in `/admin`.
- If you fill in `RESEND_API_KEY`, `NOTIFY_EMAIL`, and `NOTIFY_FROM` in `.env`, you'll
  also get an email the moment someone submits a form. [Resend](https://resend.com)
  has a free tier (100 emails/day) and needs no mail server — just an API key.
  Leave it blank and submissions still save, you just won't get an email.

If the backend isn't running (say, you're previewing the static files directly),
the forms still show the friendly "you're in" confirmation — they just won't be
saved anywhere. So nothing breaks if you haven't deployed this yet.

## 3. Managing the archive from `/admin`

Under the **Archive** tab you can:
- Add a new photo (drag a file in — a thumbnail is generated automatically in
  your browser, no image-editing software needed)
- Edit a caption or category
- Toggle **Featured** to control what shows up in the small curated grid on the
  archive page (everything else is still stored, just not shown there)
- Delete a photo

Changes appear on the live site immediately — no rebuild or redeploy needed.

## 4. Instagram setup

The archive page can show your real, live Instagram posts. There are two ways to
do this depending on how "live" you need it:

### Option A — the quick way (already wired into the HTML, no backend needed)
Open `archive.html` and find the `INTEGRATION POINT` comment. Replace the three
placeholder `data-instgrm-permalink` links with real post URLs (open a post on
Instagram → **⋯** → **Copy Link**). Instagram's own embed script renders those
live — no backend, no API key. You'll need to swap the links in manually
whenever you want to feature newer posts.

### Option B — the live-feed way (uses this backend, updates automatically)
This is what the **Instagram** tab in `/admin` connects to. It always shows your
most recent posts without you doing anything, but it takes about 15 minutes to
set up once with Meta:

1. Your Instagram account needs to be a **Business or Creator** account, linked
   to a Facebook Page (Instagram app → Settings → Account type).
2. Go to [developers.facebook.com](https://developers.facebook.com) → **My Apps**
   → **Create App** → choose "Other" → "Business".
3. Add the **Instagram Graph API** product to the app.
4. Under **Tools → Graph API Explorer**, select your app, select your Instagram
   Business account, and request the `instagram_basic` permission. Generate a
   **User Access Token**.
5. Exchange that short-lived token for a **long-lived token** (lasts ~60 days,
   auto-refreshable) — Meta's docs walk through this with one API call:
   https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/business-login-for-instagram#long-lived-access-tokens
6. You'll also need your **Instagram User ID**, which the Graph API Explorer
   shows you alongside the token.
7. Paste both into the **Instagram** tab in `/admin` and click "Save & connect."

The long-lived token expires roughly every 60 days and needs refreshing — that's
the one piece of ongoing maintenance this option has. If that's more than you want
to deal with, a paid/free third-party widget (SnapWidget, Elfsight, Behold.so)
handles that refresh for you in exchange for a monthly fee on some of them — Option A
above with manually-swapped permalinks is the zero-maintenance middle ground.

## 5. Deploying it for real

This is a single small Node process — it runs well on any of these (all have
generous free tiers for a site this size):

- **Render** (render.com) — connect your GitHub repo, set the start command to
  `node server.js`, add your `.env` values as environment variables in their
  dashboard, done.
- **Railway** (railway.app) — same idea, similarly simple.
- **Fly.io** — a bit more setup but works well too.

A few things to set as environment variables on whichever host you pick (same
names as `.env.example`):
`PORT` (usually set automatically by the host), `SITE_DIR`, `ADMIN_PASSWORD_HASH`,
`SESSION_SECRET`, and the Resend/Instagram values if you're using them.

**Important:** the SQLite database (`data/app.db`) and any photos uploaded through
`/admin` are stored as files on disk. Most hosts wipe the disk on every deploy
unless you attach a **persistent volume/disk** — look for that setting on whichever
host you choose and point it at the `backend/data` folder and the site's
`images/full` and `images/thumb` folders, or your submissions and uploaded
photos will disappear on the next deploy.

## 6. Project layout

```
backend/
  server.js          — the whole HTTP server + all API routes
  lib/
    db.js            — SQLite setup (submissions, archive_items, sessions, settings)
    auth.js          — admin password check + session cookies
    instagram.js      — fetches + caches your Instagram posts
    notify.js         — optional email-on-submit via Resend
    seed.js            — imports the existing archive/manifest.json on first run
    env.js             — tiny .env file reader
  public/admin/       — the admin panel (plain HTML/CSS/JS, no build step)
  data/               — SQLite database lives here (created automatically)
```
