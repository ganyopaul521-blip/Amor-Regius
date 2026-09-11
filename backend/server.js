require("dotenv").config();
const express = require("express");
const cors = require("cors");

// Idempotent (INSERT OR IGNORE + per-category nominee count check) - safe to
// run on every boot. This means a fresh production database (e.g. a new
// Render deploy, which starts empty) seeds itself automatically without
// needing shell/CLI access to the server, while an already-seeded database
// (like local dev) just logs "already exist" and changes nothing.
require("./seed");

const paystack = require("./paystack");
const mailer = require("./mailer");
const { EVENT_NAME, EVENT_SUBTITLE, ORG_NAME, EVENT_DATE_LINE, EVENT_TIME, EVENT_VENUE } = require("./ticket");
const votesRouter = require("./routes/votes");
const ticketsRouter = require("./routes/tickets");
const adminRouter = require("./routes/admin");
const galleryRouter = require("./routes/gallery");

const app = express();

// FRONTEND_ORIGIN restricts CORS to the deployed frontend in production
// (comma-separated for multiple, e.g. a Vercel prod + preview URL). Left
// unset, it stays open - so local dev and any not-yet-configured deploy
// keep working exactly as before.
const allowedOrigins = (process.env.FRONTEND_ORIGIN || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
app.use(
  cors(
    allowedOrigins.length
      ? { origin: allowedOrigins }
      : undefined
  )
);
app.use(express.json());

// Gallery photos are hosted on Cloudinary now, not served locally - no
// static file route or persistent disk needed.

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get("/api/config", (req, res) => {
  res.json({
    eventName: EVENT_NAME,
    eventSubtitle: EVENT_SUBTITLE,
    orgName: ORG_NAME,
    eventDateLine: EVENT_DATE_LINE,
    eventTime: EVENT_TIME,
    eventVenue: EVENT_VENUE,
    votePriceGhs: Number(process.env.VOTE_PRICE_GHS || 1),
    paystackPublicKey: paystack.publicKey(),
    paystackConfigured: paystack.isConfigured(),
    paystackFeeRate: paystack.FEE_RATE,
    emailConfigured: mailer.isConfigured(),
  });
});

app.use("/api/votes", votesRouter);
app.use("/api/tickets", ticketsRouter);
app.use("/api/admin", adminRouter);
app.use("/api/gallery", galleryRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`${EVENT_NAME} backend running on http://localhost:${PORT}`);
});
