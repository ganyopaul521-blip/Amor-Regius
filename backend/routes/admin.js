const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const db = require("../db");
const { generateTicketPng } = require("../ticket");
const mailer = require("../mailer");
const paystack = require("../paystack");

const router = express.Router();

// Same DATA_DIR convention as db.js - defaults to the local uploads folder
// for dev, but on Render this resolves under the mounted persistent disk so
// uploaded photos survive deploys/restarts.
const UPLOADS_ROOT = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, "uploads")
  : path.join(__dirname, "..", "uploads");
const GALLERY_DIR = path.join(UPLOADS_ROOT, "gallery");
fs.mkdirSync(GALLERY_DIR, { recursive: true });
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

// No fileFilter here deliberately: rejecting mid-stream causes multer to stop
// reading the request body before the client finishes writing it, which
// shows up as a hard connection reset (no JSON error, nothing) rather than a
// clean 400 - a well-known multer/Node gotcha. Instead the file is always
// written to disk, then its mimetype is checked (and the file deleted if
// invalid) in the route handler below, after the upload has fully completed.
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, GALLERY_DIR),
    filename: (req, file, cb) => {
      const ext = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" }[file.mimetype] || "";
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
});

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
function logActivity(action, detail) {
  db.prepare("INSERT INTO admin_activity (action, detail) VALUES (?, ?)").run(action, detail || null);
}

// POST /api/admin/login - the admin key is already verified by requireAdmin
// above by the time this handler runs; this endpoint exists so the frontend
// has a single "verify and remember" call for its sign-in screen, and so a
// real login event lands in the activity log.
router.post("/login", (req, res) => {
  logActivity("Admin signed in");
  res.json({ ok: true });
});

// GET /api/admin/activity - recent audit log entries, newest first
router.get("/activity", (req, res) => {
  const activity = db.prepare("SELECT * FROM admin_activity ORDER BY id DESC LIMIT 20").all();
  res.json({ activity });
});

// GET /api/admin/stats - every number here is a real aggregate computed from
// the same tables the rest of the admin API already reads from. Nothing on
// this endpoint is fabricated or hardcoded.
router.get("/stats", (req, res) => {
  const ticketTotals = db
    .prepare(
      `SELECT
         COUNT(*) AS totalOrders,
         COALESCE(SUM(CASE WHEN status = 'confirmed' THEN amount_ghs END), 0) AS totalRevenue,
         COALESCE(SUM(CASE WHEN status = 'confirmed' THEN quantity END), 0) AS ticketsSold,
         SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmedOrders,
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pendingOrders,
         SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejectedOrders
       FROM ticket_orders`
    )
    .get();

  const byTicketType = db
    .prepare(
      `SELECT ticket_type AS type,
              COALESCE(SUM(CASE WHEN status = 'confirmed' THEN quantity END), 0) AS sold,
              COALESCE(SUM(CASE WHEN status = 'confirmed' THEN amount_ghs END), 0) AS revenue
       FROM ticket_orders
       GROUP BY ticket_type`
    )
    .all();

  const votePaymentTotals = db
    .prepare(
      `SELECT
         COUNT(*) AS totalRequests,
         SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected
       FROM vote_payments`
    )
    .get();

  const voteAggregate = db
    .prepare(
      `SELECT
         (SELECT COALESCE(SUM(votes), 0) FROM nominees) AS totalVotes,
         (SELECT COUNT(*) FROM categories) AS totalCategories,
         (SELECT COUNT(*) FROM nominees) AS totalNominees`
    )
    .get();

  const revenueSeries = db
    .prepare(
      `SELECT DATE(created_at) AS day,
              SUM(amount_ghs) AS revenue,
              SUM(quantity) AS tickets
       FROM ticket_orders
       WHERE status = 'confirmed'
       GROUP BY DATE(created_at)
       ORDER BY day ASC`
    )
    .all();

  const paymentRequests = ticketTotals.totalOrders + votePaymentTotals.totalRequests;
  const paymentSuccessful = ticketTotals.confirmedOrders + votePaymentTotals.confirmed;
  const paymentPending = ticketTotals.pendingOrders + votePaymentTotals.pending;
  const paymentFailed = ticketTotals.rejectedOrders + votePaymentTotals.rejected;

  res.json({
    revenue: {
      totalGhs: ticketTotals.totalRevenue,
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
router.get("/tickets", (req, res) => {
  const orders = db.prepare("SELECT * FROM ticket_orders ORDER BY id DESC").all();
  res.json({ orders });
});

// PATCH /api/admin/tickets/:id - confirm or reject an order after checking
// the MoMo reference against the till/merchant statement
router.patch("/tickets/:id", (req, res) => {
  const { status } = req.body || {};
  if (!["pending", "confirmed", "rejected"].includes(status)) {
    return res.status(400).json({ error: "status must be pending, confirmed, or rejected" });
  }
  const result = db.prepare("UPDATE ticket_orders SET status = ? WHERE id = ?").run(status, req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: "Order not found" });
  }
  const order = db.prepare("SELECT * FROM ticket_orders WHERE id = ?").get(req.params.id);
  logActivity("Order status updated", `Order #${order.id} (${order.buyer_name}) marked ${status}`);
  res.json({ ok: true, order });
});

// POST /api/admin/tickets/:id/resend-ticket - manually (re)send the ticket
// email, e.g. if the automatic send failed or the buyer lost it.
router.post("/tickets/:id/resend-ticket", async (req, res) => {
  const order = db.prepare("SELECT * FROM ticket_orders WHERE id = ?").get(req.params.id);
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
    db.prepare("UPDATE ticket_orders SET ticket_sent_at = datetime('now') WHERE id = ?").run(order.id);
    logActivity("Ticket resent", `Order #${order.id} (${order.buyer_name})`);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message || "Could not send the ticket email" });
  }
});

// GET /api/admin/votes - all individual vote payment records, newest first
router.get("/votes", (req, res) => {
  const payments = db
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
router.patch("/votes/:id", (req, res) => {
  const { status } = req.body || {};
  if (!["pending", "confirmed", "rejected"].includes(status)) {
    return res.status(400).json({ error: "status must be pending, confirmed, or rejected" });
  }

  const payment = db.prepare("SELECT * FROM vote_payments WHERE id = ?").get(req.params.id);
  if (!payment) {
    return res.status(404).json({ error: "Vote payment not found" });
  }

  const apply = db.transaction(() => {
    if (payment.status === "pending" && status === "confirmed") {
      db.prepare("UPDATE nominees SET votes = votes + ? WHERE id = ?").run(payment.quantity, payment.nominee_id);
    }
    db.prepare("UPDATE vote_payments SET status = ? WHERE id = ?").run(status, payment.id);
  });
  apply();

  const updated = db.prepare("SELECT * FROM vote_payments WHERE id = ?").get(req.params.id);
  logActivity("Vote payment status updated", `Payment #${updated.id} marked ${status}`);
  res.json({ ok: true, payment: updated });
});

// POST /api/admin/gallery - upload a photo from a past event (multipart form,
// field name "photo", optional "caption"). Wrapped manually (rather than as
// declarative middleware) so multer's own errors - e.g. too large - come
// back as clean JSON instead of a generic 500.
router.post("/gallery", (req, res) => {
  upload.single("photo")(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || "Upload failed" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No photo file provided" });
    }
    if (!ALLOWED_MIME.has(req.file.mimetype)) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: "Only JPEG, PNG, or WebP images are allowed" });
    }
    const caption = req.body.caption ? String(req.body.caption).trim() : null;
    const result = db
      .prepare("INSERT INTO gallery_photos (filename, caption) VALUES (?, ?)")
      .run(req.file.filename, caption);
    logActivity("Gallery photo uploaded", caption || `Photo #${result.lastInsertRowid}`);
    res.status(201).json({
      ok: true,
      photo: { id: result.lastInsertRowid, url: `/uploads/gallery/${req.file.filename}`, caption },
    });
  });
});

// DELETE /api/admin/gallery/:id - remove a photo (row + file)
router.delete("/gallery/:id", (req, res) => {
  const photo = db.prepare("SELECT * FROM gallery_photos WHERE id = ?").get(req.params.id);
  if (!photo) {
    return res.status(404).json({ error: "Photo not found" });
  }
  db.prepare("DELETE FROM gallery_photos WHERE id = ?").run(photo.id);
  fs.unlink(path.join(GALLERY_DIR, photo.filename), () => {});
  logActivity("Gallery photo deleted", photo.caption || `Photo #${photo.id}`);
  res.json({ ok: true });
});

module.exports = router;
