const express = require("express");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const db = require("../db");
const { generateTicketPng } = require("../ticket");
const mailer = require("../mailer");
const paystack = require("../paystack");

const router = express.Router();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Buffered in memory, then uploaded to Cloudinary - no local disk involved,
// so this survives Render restarts/redeploys without a persistent disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

function requireAdmin(req, res, next) {
  const key = req.header("x-admin-key");
  if (!key || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: "Invalid or missing admin key" });
  }
  next();
}

router.use(requireAdmin);

// Real audit trail (backs the dashboard's Recent Activity panel) - every row
// here corresponds to an actual administrative action that just happened,
// never fabricated.
async function logActivity(action, detail) {
  await db.prepare("INSERT INTO admin_activity (action, detail) VALUES (?, ?)").run(action, detail || null);
}

// POST /api/admin/login - the admin key is already verified by requireAdmin
// above by the time this handler runs; this endpoint exists so the frontend
// has a single "verify and remember" call for its sign-in screen, and so a
// real login event lands in the activity log.
router.post("/login", async (req, res) => {
  await logActivity("Admin signed in");
  res.json({ ok: true });
});

// GET /api/admin/activity - recent audit log entries, newest first
router.get("/activity", async (req, res) => {
  const activity = await db.prepare("SELECT * FROM admin_activity ORDER BY id DESC LIMIT 20").all();
  res.json({ activity });
});

// GET /api/admin/stats - every number here is a real aggregate computed from
// the same tables the rest of the admin API already reads from. Nothing on
// this endpoint is fabricated or hardcoded.
router.get("/stats", async (req, res) => {
  const ticketTotals = await db
    .prepare(
      `SELECT
         COUNT(*) AS totalOrders,
         COALESCE(SUM(CASE WHEN status = 'confirmed' THEN base_amount_ghs END), 0) AS totalRevenue,
         COALESCE(SUM(CASE WHEN status = 'confirmed' THEN quantity END), 0) AS ticketsSold,
         SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmedOrders,
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pendingOrders,
         SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejectedOrders
       FROM ticket_orders`
    )
    .get();

  const byTicketType = await db
    .prepare(
      `SELECT ticket_type AS type,
              COALESCE(SUM(CASE WHEN status = 'confirmed' THEN quantity END), 0) AS sold,
              COALESCE(SUM(CASE WHEN status = 'confirmed' THEN base_amount_ghs END), 0) AS revenue
       FROM ticket_orders
       GROUP BY ticket_type`
    )
    .all();

  const votePaymentTotals = await db
    .prepare(
      `SELECT
         COUNT(*) AS totalRequests,
         SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected
       FROM vote_payments`
    )
    .get();

  const voteAggregate = await db
    .prepare(
      `SELECT
         (SELECT COALESCE(SUM(votes), 0) FROM nominees) AS totalVotes,
         (SELECT COUNT(*) FROM categories) AS totalCategories,
         (SELECT COUNT(*) FROM nominees) AS totalNominees,
         (SELECT COALESCE(SUM(base_amount_ghs), 0) FROM vote_payments WHERE status = 'confirmed') AS totalRevenue`
    )
    .get();

  const ticketRevenueSeries = await db
    .prepare(
      `SELECT DATE(created_at) AS day,
              SUM(base_amount_ghs) AS revenue,
              SUM(quantity) AS tickets
       FROM ticket_orders
       WHERE status = 'confirmed'
       GROUP BY DATE(created_at)`
    )
    .all();

  const voteRevenueSeries = await db
    .prepare(
      `SELECT DATE(created_at) AS day,
              SUM(base_amount_ghs) AS revenue
       FROM vote_payments
       WHERE status = 'confirmed'
       GROUP BY DATE(created_at)`
    )
    .all();

  // Combined so the "Revenue Over Time" chart and the Total Revenue KPI
  // agree with each other - every confirmed vote payment counts toward
  // revenue here too, not just ticket orders.
  const revenueByDay = new Map();
  for (const row of ticketRevenueSeries) {
    revenueByDay.set(row.day, { day: row.day, revenue: row.revenue, tickets: row.tickets });
  }
  for (const row of voteRevenueSeries) {
    const existing = revenueByDay.get(row.day);
    if (existing) {
      existing.revenue += row.revenue;
    } else {
      revenueByDay.set(row.day, { day: row.day, revenue: row.revenue, tickets: 0 });
    }
  }
  const revenueSeries = [...revenueByDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));

  const paymentRequests = ticketTotals.totalOrders + votePaymentTotals.totalRequests;
  const paymentSuccessful = ticketTotals.confirmedOrders + votePaymentTotals.confirmed;
  const paymentPending = ticketTotals.pendingOrders + votePaymentTotals.pending;
  const paymentFailed = ticketTotals.rejectedOrders + votePaymentTotals.rejected;

  res.json({
    revenue: {
      totalGhs: ticketTotals.totalRevenue + voteAggregate.totalRevenue,
      ticketRevenueGhs: ticketTotals.totalRevenue,
      voteRevenueGhs: voteAggregate.totalRevenue,
      byTicketType: byTicketType.reduce((acc, row) => {
        acc[row.type] = { sold: row.sold, revenueGhs: row.revenue };
        return acc;
      }, {}),
      series: revenueSeries,
    },
    tickets: {
      sold: ticketTotals.ticketsSold,
      totalOrders: ticketTotals.totalOrders,
      confirmed: ticketTotals.confirmedOrders,
      pending: ticketTotals.pendingOrders,
      rejected: ticketTotals.rejectedOrders,
    },
    payments: {
      totalRequests: paymentRequests,
      successful: paymentSuccessful,
      pending: paymentPending,
      failed: paymentFailed,
      successRate: paymentRequests > 0 ? Math.round((paymentSuccessful / paymentRequests) * 1000) / 10 : null,
    },
    voting: voteAggregate,
    services: {
      paystackConfigured: paystack.isConfigured(),
      emailConfigured: mailer.isConfigured(),
    },
  });
});

// GET /api/admin/tickets - all ticket orders, newest first
router.get("/tickets", async (req, res) => {
  const orders = await db.prepare("SELECT * FROM ticket_orders ORDER BY id DESC").all();
  res.json({ orders });
});

// PATCH /api/admin/tickets/:id - confirm or reject an order after checking
// the MoMo reference against the till/merchant statement
router.patch("/tickets/:id", async (req, res) => {
  const { status } = req.body || {};
  if (!["pending", "confirmed", "rejected"].includes(status)) {
    return res.status(400).json({ error: "status must be pending, confirmed, or rejected" });
  }
  const result = await db.prepare("UPDATE ticket_orders SET status = ? WHERE id = ?").run(status, req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: "Order not found" });
  }
  const order = await db.prepare("SELECT * FROM ticket_orders WHERE id = ?").get(req.params.id);
  await logActivity("Order status updated", `Order #${order.id} (${order.buyer_name}) marked ${status}`);
  res.json({ ok: true, order });
});

// POST /api/admin/tickets/:id/resend-ticket - manually (re)send the ticket
// email, e.g. if the automatic send failed or the buyer lost it.
router.post("/tickets/:id/resend-ticket", async (req, res) => {
  const order = await db.prepare("SELECT * FROM ticket_orders WHERE id = ?").get(req.params.id);
  if (!order) {
    return res.status(404).json({ error: "Order not found" });
  }
  if (order.status !== "confirmed") {
    return res.status(409).json({ error: "Order is not confirmed yet" });
  }
  if (!order.buyer_email) {
    return res.status(400).json({ error: "This order has no email on file" });
  }

  try {
    const png = await generateTicketPng(order);
    await mailer.sendTicketEmail(order, png);
    await db.prepare("UPDATE ticket_orders SET ticket_sent_at = datetime('now') WHERE id = ?").run(order.id);
    await logActivity("Ticket resent", `Order #${order.id} (${order.buyer_name})`);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message || "Could not send the ticket email" });
  }
});

// GET /api/admin/votes - all individual vote payment records, newest first
router.get("/votes", async (req, res) => {
  const payments = await db
    .prepare(
      `SELECT vp.*, n.name AS nominee_name, c.name AS category_name
       FROM vote_payments vp
       JOIN nominees n ON n.id = vp.nominee_id
       JOIN categories c ON c.id = n.category_id
       ORDER BY vp.id DESC`
    )
    .all();
  res.json({ payments });
});

// PATCH /api/admin/votes/:id - manual override for when a payment needs
// correcting by hand. Mirrors the status-poll guard in routes/votes.js: the
// nominee tally only moves on the transition out of 'pending', so this
// can't double count.
router.patch("/votes/:id", async (req, res) => {
  const { status } = req.body || {};
  if (!["pending", "confirmed", "rejected"].includes(status)) {
    return res.status(400).json({ error: "status must be pending, confirmed, or rejected" });
  }

  const payment = await db.prepare("SELECT * FROM vote_payments WHERE id = ?").get(req.params.id);
  if (!payment) {
    return res.status(404).json({ error: "Vote payment not found" });
  }

  const apply = db.transaction(async (db) => {
    // Same atomic claim as routes/votes.js's status poll - re-checks
    // status = 'pending' fresh at write time instead of trusting the
    // `payment` snapshot fetched above, so this can't double-credit votes
    // if it ever races another confirmation of the same payment.
    const update = await db
      .prepare("UPDATE vote_payments SET status = ? WHERE id = ? AND status = 'pending'")
      .run(status, payment.id);

    if (update.changes > 0 && status === "confirmed") {
      await db.prepare("UPDATE nominees SET votes = votes + ? WHERE id = ?").run(payment.quantity, payment.nominee_id);
    } else if (update.changes === 0) {
      // Payment wasn't 'pending' (e.g. already confirmed/rejected) - still
      // apply the requested status, just without touching the vote tally.
      await db.prepare("UPDATE vote_payments SET status = ? WHERE id = ?").run(status, payment.id);
    }
  });
  await apply();

  const updated = await db.prepare("SELECT * FROM vote_payments WHERE id = ?").get(req.params.id);
  await logActivity("Vote payment status updated", `Payment #${updated.id} marked ${status}`);
  res.json({ ok: true, payment: updated });
});

// POST /api/admin/gallery - upload a photo from a past event (multipart form,
// field name "photo", optional "caption") straight to Cloudinary. Wrapped
// manually (rather than as declarative middleware) so multer's own errors -
// e.g. too large - come back as clean JSON instead of a generic 500.
router.post("/gallery", (req, res) => {
  upload.single("photo")(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || "Upload failed" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No photo file provided" });
    }
    if (!ALLOWED_MIME.has(req.file.mimetype)) {
      return res.status(400).json({ error: "Only JPEG, PNG, or WebP images are allowed" });
    }

    try {
      const dataUri = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
      const uploaded = await cloudinary.uploader.upload(dataUri, { folder: "amor-regius-gallery" });

      const caption = req.body.caption ? String(req.body.caption).trim() : null;
      const result = await db
        .prepare("INSERT INTO gallery_photos (url, cloudinary_public_id, caption) VALUES (?, ?, ?)")
        .run(uploaded.secure_url, uploaded.public_id, caption);
      await logActivity("Gallery photo uploaded", caption || `Photo #${result.lastInsertRowid}`);
      res.status(201).json({
        ok: true,
        photo: { id: result.lastInsertRowid, url: uploaded.secure_url, caption },
      });
    } catch (uploadErr) {
      res.status(502).json({ error: uploadErr.message || "Could not upload photo" });
    }
  });
});

// DELETE /api/admin/gallery/:id - remove a photo (row + Cloudinary asset)
router.delete("/gallery/:id", async (req, res) => {
  const photo = await db.prepare("SELECT * FROM gallery_photos WHERE id = ?").get(req.params.id);
  if (!photo) {
    return res.status(404).json({ error: "Photo not found" });
  }
  await db.prepare("DELETE FROM gallery_photos WHERE id = ?").run(photo.id);
  cloudinary.uploader.destroy(photo.cloudinary_public_id).catch(() => {});
  await logActivity("Gallery photo deleted", photo.caption || `Photo #${photo.id}`);
  res.json({ ok: true });
});

module.exports = router;
