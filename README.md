# Amor Regius — Dinner & Awards Night

A ticket-purchase and awards-voting site for the RoyalHouse Chapel Students
Association (University of Ghana)'s Amor Regius Dinner & Awards Night, held
Sunday 20th September 2026. Both flows are paid via **Paystack** (card or
Ghana Mobile Money — MTN, Vodafone Cash, AirtelTigo, all supported), using
Paystack's inline popup so the buyer never leaves this site.

Once a ticket order is confirmed, a ticket image (event branding, buyer
name, ticket type, the date, a unique ticket ID, and a QR code for door
scanning) is generated and emailed to the buyer automatically, and is also
downloadable straight from the confirmation screen.

There's also a public photo gallery (`gallery.html`) of past events, with
photos uploaded and managed from the admin page.

## Structure

```
frontend/   Static site (no build step) — home, tickets, vote, admin pages
backend/    Node/Express API + Turso database + Cloudinary + Paystack + ticket + email
```

## Setting up data storage (Turso + Cloudinary, both free)

The database and gallery photos live on two free hosted services instead of
local disk — this means the backend can run on a platform with no persistent
storage of its own (like Render's free tier) without losing anything on
restart.

1. **Turso** (a SQLite-compatible hosted database — same SQL as before, just
   networked): sign up at [turso.tech](https://turso.tech), create a
   database, and grab its **Database URL** and an **Auth Token** (Read &
   Write, no expiry) from the dashboard.
2. **Cloudinary** (image hosting for gallery photos): sign up at
   [cloudinary.com](https://cloudinary.com) — the dashboard shows your
   **Cloud Name**, **API Key**, and **API Secret** immediately.
3. Put all five in `backend/.env`:
   ```
   TURSO_DATABASE_URL=libsql://...
   TURSO_AUTH_TOKEN=...
   CLOUDINARY_CLOUD_NAME=...
   CLOUDINARY_API_KEY=...
   CLOUDINARY_API_SECRET=...
   ```

`backend/db.js` creates its tables automatically on first connection — no
separate setup step needed once these are in `.env`.

## Setting up real payments (Paystack, personal account)

1. Sign up at [dashboard.paystack.com/#/signup](https://dashboard.paystack.com/#/signup)
   as an **individual** (not a registered business) — Ghana's personal-account
   KYC needs a government-issued ID (passport/National ID/driver's licence/
   voter's card) plus a Tax Identification Number, all matching the same
   name. Test-mode keys work immediately, before that KYC is submitted or
   approved.
2. Dashboard → **Settings → API Keys & Webhooks** — copy the **Secret Key**
   and **Public Key**.
3. Put them in `backend/.env`:
   ```
   PAYSTACK_SECRET_KEY=sk_test_...
   PAYSTACK_PUBLIC_KEY=pk_test_...
   ```
   The secret key is never sent to the browser. The public key is safe to
   expose — it's already returned by `/api/config` for the frontend's popup.
4. Test mode supports Ghana Mobile Money and card without any real money
   moving — Paystack's docs list test Mobile Money numbers/OTPs for
   simulating success/failure. Switch to live keys (`sk_live_...`/
   `pk_live_...`) once KYC is approved and you're ready to accept real
   payments — no code change needed, only the `.env` values.

There's no webhook/public-URL requirement — the backend confirms payment by
verifying the transaction reference against Paystack's own record whenever
the frontend checks an order's status, so this works fine even on
`localhost`. Every confirmation also re-checks the paid amount against what
the order was created for server-side, so a tampered client-side popup call
can't sneak through as a real payment.

> Paystack settles to a **bank account**, not a Mobile Money wallet — plan
> for that when setting up your payout account during KYC.

## Setting up ticket email delivery (your own Gmail account, no third party)

1. Turn on **2-Step Verification** on the Gmail account you want tickets to
   be sent from: https://myaccount.google.com/security
2. Create an **App Password**: https://myaccount.google.com/apppasswords
   (this is a 16-character code, not your normal Gmail login password —
   Google blocks plain-password SMTP login for security).
3. Put them in `backend/.env`:
   ```
   GMAIL_USER=youraddress@gmail.com
   GMAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx
   ```

If this isn't configured, ticket purchases still work fine — the buyer just
sees a "Download Ticket" button on the confirmation screen instead of
getting an email (and the admin panel shows "Not sent" with a manual
**Resend** button, which also works once email is configured).

> **Hosting note:** Gmail SMTP needs outbound ports 465/587 open. Render's
> **free** web service tier blocks those specifically to prevent spam abuse
> (confirmed via a real "Connection timeout" on this project) — a **Starter**
> instance or above doesn't have that restriction. This is the one remaining
> reason this backend needs a paid Render instance; the database and gallery
> photos no longer do, now that they live on Turso/Cloudinary.

The ticket image itself is built in `backend/ticket.js` (an SVG template
rendered to PNG via `sharp`, with a QR code from the `qrcode` package
encoding the order's unique reference). To change the design, event name,
date, or org name shown on the ticket, edit the constants at the top of that
file — `server.js`'s `/api/config` endpoint also reads from those same
constants, so it only needs changing in one place.

## Running it

**Backend** (from `backend/`):

```bash
npm install
copy .env.example .env      # then fill in ADMIN_KEY, Paystack keys, Gmail keys, etc.
npm run seed                # seeds placeholder award nominees
npm start                   # runs on http://localhost:4000
```

**Frontend** (from `frontend/`): just open `index.html` in a browser, or
serve the folder with any static server, e.g. `npx serve .`. It talks to the
backend at `http://localhost:4000/api` by default — change `API_BASE` in
`assets/js/api.js` (or set `window.ROSA_API_BASE` before that script loads)
if you deploy the backend elsewhere.

## Deployment: backend on Render, frontend on Vercel

The backend's actual data (database + gallery photos) lives on Turso and
Cloudinary now, not local disk — so unlike an earlier version of this setup,
Render's own persistent-disk feature isn't needed at all. The backend still
needs a **paid** Render instance type, but only because Gmail SMTP needs
ports Render's free tier blocks (see the email section above) — nothing to
do with data persistence anymore.

### 1. Backend → Render

1. Push this repo to GitHub (already done), then in the
   [Render dashboard](https://dashboard.render.com), click **New → Blueprint**
   and point it at the repo — it will read `render.yaml` at the repo root
   and set up a web service (rooted at `backend/`) on the **Starter** plan
   (currently ~$7/month, needed for SMTP as noted above).
2. When prompted for environment variables (all marked `sync: false` in
   `render.yaml` so they're never stored in the repo), paste in the same
   values as your local `backend/.env`: `ADMIN_KEY`, `VOTE_PRICE_GHS`, the
   three `TICKET_*_PRICE_GHS`, `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`,
   `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `TURSO_DATABASE_URL`,
   `TURSO_AUTH_TOKEN`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`,
   `CLOUDINARY_API_SECRET`. Leave `FRONTEND_ORIGIN` for step 3.
   **Change `ADMIN_KEY` from the placeholder before going live.**
3. Once deployed, Render gives you a URL like
   `https://amor-regius-backend.onrender.com`. Note it for step 4. Since the
   database is shared (Turso), nominee categories and any real data already
   seeded/migrated show up immediately — no first-deploy empty-state step.

### 2. Frontend → Vercel

1. In the [Vercel dashboard](https://vercel.com/new), import the same GitHub
   repo. When it asks for the **Root Directory**, set it to `frontend` (this
   is what `frontend/vercel.json` is for — a plain static site, no build
   command needed).
2. Before deploying, open `frontend/assets/js/config.js` and set
   `RENDER_BACKEND_URL` to the exact URL from Render step 3 above, then
   commit and push (Vercel will redeploy automatically). Local dev
   (`localhost`/`127.0.0.1`) is unaffected — it always talks to
   `http://localhost:4000` regardless of this value.
3. Vercel gives you a URL like `https://amor-regius.vercel.app`. Add it (and
   your custom domain, if any) as `FRONTEND_ORIGIN` in Render's environment
   variables — comma-separated if more than one — so the backend's CORS only
   accepts requests from your real frontend instead of any origin.

### Keeping both in sync after this

- Any push to the branch Render/Vercel are watching redeploys both
  automatically.
- If you ever change `RENDER_BACKEND_URL` in `config.js` or `FRONTEND_ORIGIN`
  on Render, both sides need the matching update or CORS will block requests.

## Editing nominees

Real nominee names aren't in yet — edit the `CATEGORIES` list in
`backend/seed.js` and re-run `npm run seed`.

## Admin

Open `frontend/admin.html`, enter the `ADMIN_KEY` from your `.env`, and click
"Load Data" to see ticket orders and vote payments, including the Paystack
payment reference and status. Both tables have a manual status override in case
a payment needs correcting by hand — changing a vote payment to "confirmed"
there adds its votes to the nominee's tally exactly once, same as a real
confirmation does.

The same page's **Photo Gallery** section (doesn't need "Load Data" first,
just the admin key) lets you upload JPEG/PNG/WebP photos (up to 8MB) with an
optional caption — they appear on the public `gallery.html` page
immediately, and can be deleted from either page's controls. Uploaded files
go straight to Cloudinary (no local disk involved), and the database stores
the resulting URL plus the Cloudinary `public_id` needed to delete it later.
