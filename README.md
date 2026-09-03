# Amor Regius — Dinner & Awards Night

A ticket-purchase and awards-voting site for the RoyalHouse Chapel Students
Association (University of Ghana)'s Amor Regius Dinner & Awards Night, held
Sunday 20th September 2026. Both flows charge the buyer/voter's own **MTN
Mobile Money** wallet directly through MTN's own MoMo Open API (Collections)
— no payment aggregator in the middle, funds settle straight into your MTN
MoMo account. Because it's a direct telco integration, it only works for
payers on the MTN network (Vodafone/Telecel and AirtelTigo numbers can't be
charged this way).

Once a ticket order is confirmed, a ticket image (event branding, buyer
name, ticket type, the date, a unique ticket ID, and a QR code for door
scanning) is generated and emailed to the buyer automatically, and is also
downloadable straight from the confirmation screen.

There's also a public photo gallery (`gallery.html`) of past events, with
photos uploaded and managed from the admin page.

## Structure

```
frontend/   Static site (no build step) — home, tickets, vote, admin pages
backend/    Node/Express API + SQLite database + MTN MoMo + ticket + email
```

## Setting up real Mobile Money payments (MTN MoMo, direct)

### Sandbox (free, self-service, for testing)

1. Sign up at [momodeveloper.mtn.com](https://momodeveloper.mtn.com) and
   subscribe to the product literally named **"Collections | Enable remote
   collection of bills, fees or taxes"** to get a subscription key. Don't
   subscribe to "Collection Widget" instead - that's a different, hosted
   checkout product and its key will fail with a generic 401 on the
   endpoints this app calls.
2. Put it in `backend/.env` as `MTN_SUBSCRIPTION_KEY`.
3. From `backend/`, run:
   ```bash
   npm run mtn-setup
   ```
   This self-provisions a sandbox API user/key and prints the values to
   paste into `backend/.env` (`MTN_API_USER`, `MTN_API_KEY`).
4. Leave `MTN_BASE_URL`, `MTN_TARGET_ENVIRONMENT`, and `MTN_CURRENCY` at
   their sandbox defaults (see `.env.example`) — sandbox only accepts `EUR`
   as the currency regardless of country; that's normal, not a bug, and has
   no bearing on the real GHS prices shown to users.
5. In MTN's sandbox, there's no real phone to approve a prompt on — check
   MTN's sandbox docs for how to simulate a successful/failed payment for a
   given test MSISDN.

### Production (real money)

MTN does **not** let you self-provision production credentials the way
sandbox does. You'll need to:

1. Go through MTN's MoMo Collections onboarding (business KYC, approval via
   an account manager and the MoMo Partner Portal). This can take some time
   and isn't instant.
2. Once approved, you'll receive production `API_User`/`API_Key` from your
   account manager, and a production subscription key from
   [momoapi.mtn.com](https://momoapi.mtn.com).
3. Update `backend/.env`:
   ```
   MTN_BASE_URL=https://proxy.momoapi.mtn.com
   MTN_TARGET_ENVIRONMENT=mtnghana
   MTN_CURRENCY=GHS
   MTN_SUBSCRIPTION_KEY=<production key>
   MTN_API_USER=<from MTN>
   MTN_API_KEY=<from MTN>
   ```

There's no webhook/public-URL requirement — the backend confirms payment by
polling MTN's own status endpoint whenever the frontend checks an order's
status, so this works fine even on `localhost`.

> **Confirmed against a live sandbox account:** request-to-pay and status
> polling both work end-to-end as implemented. One real gotcha found along
> the way: MTN's sandbox has a WAF that silently rejects any
> `payerMessage`/`payeeNote` containing `(`, `)`, or `#` - it returns HTTP
> 200 with an HTML "Request Rejected" body instead of a normal API error, so
> it doesn't fail loudly. `backend/mtnMomo.js`'s `sanitizeNote()` strips
> these from any text built from user/admin-entered content (e.g. a nominee
> name); if you add new message text anywhere, avoid those characters. The
> raw response from MTN's status endpoint is also stored in the
> `last_status_payload` column for debugging anything else unexpected.

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

The ticket image itself is built in `backend/ticket.js` (an SVG template
rendered to PNG via `sharp`, with a QR code from the `qrcode` package
encoding the order's unique reference). To change the design, event name,
date, or org name shown on the ticket, edit the constants at the top of that
file — `server.js`'s `/api/config` endpoint and the vote/ticket payment
messages sent to MTN also read from those same constants, so it only needs
changing in one place.

## Running it

**Backend** (from `backend/`):

```bash
npm install
copy .env.example .env      # then fill in ADMIN_KEY, MTN keys, Gmail keys, etc.
npm run seed                # seeds placeholder award nominees
npm start                   # runs on http://localhost:4000
```

**Frontend** (from `frontend/`): just open `index.html` in a browser, or
serve the folder with any static server, e.g. `npx serve .`. It talks to the
backend at `http://localhost:4000/api` by default — change `API_BASE` in
`assets/js/api.js` (or set `window.ROSA_API_BASE` before that script loads)
if you deploy the backend elsewhere.

## Editing nominees

Real nominee names aren't in yet — edit the `CATEGORIES` list in
`backend/seed.js` and re-run `npm run seed`.

## Admin

Open `frontend/admin.html`, enter the `ADMIN_KEY` from your `.env`, and click
"Load Data" to see ticket orders and vote payments, including the MTN
transaction ID and status. Both tables have a manual status override in case
a payment needs correcting by hand — changing a vote payment to "confirmed"
there adds its votes to the nominee's tally exactly once, same as a real
confirmation does.

The same page's **Photo Gallery** section (doesn't need "Load Data" first,
just the admin key) lets you upload JPEG/PNG/WebP photos (up to 8MB) with an
optional caption — they appear on the public `gallery.html` page
immediately, and can be deleted from either page's controls. Uploaded files
are stored in `backend/uploads/gallery/` (not committed to git) and served
at `/uploads/gallery/<filename>`.
