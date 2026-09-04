const express = require("express");
const db = require("../db");
const paystack = require("../paystack");
const { generateTicketPng, EVENT_NAME, EVENT_SUBTITLE } = require("../ticket");
const mailer = require("../mailer");

const router = express.Router();

const PRICES = {
  single: Number(process.env.TICKET_SINGLE_PRICE_GHS || 150),
  double: Number(process.env.TICKET_DOUBLE_PRICE_GHS || 280),
  executive: Number(process.env.TICKET_EXECUTIVE_PRICE_GHS || 180),
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET /api/tickets/pricing - so the frontend never has to hardcode prices
router.get("/pricing", (req, res) => {
  res.json({ prices: PRICES });
});

// POST /api/tickets - creates a pending order and hands back a Paystack
// reference for the frontend to open its payment popup with (card or Ghana
// Mobile Money, any network). The order is only marked 'confirmed' once
// polling (see /:id/status) verifies the payment against Paystack's own
// record, at which point the ticket is emailed automatically (see
// maybeSendTicket) - nothing here trusts the frontend's own say-so.
router.post("/", async (req, res) => {
  const { buyerName, buyerPhone, buyerEmail, ticketType, quantity } = req.body || {};

  const qty = Number(quantity);
  if (!buyerName || !String(buyerName).trim()) {
    return res.status(400).json({ error: "buyerName is required" });
  }
  if (!buyerPhone || !String(buyerPhone).trim()) {
    return res.status(400).json({ error: "buyerPhone is required" });
  }
  if (!buyerEmail || !EMAIL_RE.test(String(buyerEmail).trim())) {
    return res.status(400).json({ error: "A valid buyerEmail is required so your ticket can be sent to you" });
  }
  if (!ticketType || !PRICES[ticketType]) {
    return res.status(400).json({ error: "ticketType must be 'single', 'double', or 'executive'" });
  }
  if (!Number.isInteger(qty) || qty < 1) {
    return res.status(400).json({ error: "quantity must be a positive integer" });
  }
  if (!paystack.isConfigured()) {
    return res.status(502).json({ error: "Payments are not configured yet. Set PAYSTACK_SECRET_KEY in backend/.env." });
  }

  const baseAmountGhs = qty * PRICES[ticketType];
  // The Paystack fee is passed on to the buyer - they're charged this
  // grossed-up amount so the organizer nets exactly baseAmountGhs after
  // Paystack takes its cut. See paystack.js's amountWithFeePassedOn().
  const amountGhs = paystack.amountWithFeePassedOn(baseAmountGhs);
  const clientReference = paystack.newReferenceId();

  const insert = await db
    .prepare(
      `INSERT INTO ticket_orders (buyer_name, buyer_phone, buyer_email, ticket_type, quantity, amount_ghs, base_amount_ghs, network, client_reference, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'paystack', ?, 'pending')`
    )
    .run(
      String(buyerName).trim(),
      String(buyerPhone).trim(),
      String(buyerEmail).trim(),
      ticketType,
      qty,
      amountGhs,
      baseAmountGhs,
      clientReference
    );

  // Built directly from what was just inserted rather than a second
  // round-trip SELECT - every field the frontend needs is already known here,
  // and each Turso query is a real network call, unlike the old local file.
  const order = {
    id: insert.lastInsertRowid,
    buyer_name: String(buyerName).trim(),
    buyer_phone: String(buyerPhone).trim(),
    buyer_email: String(buyerEmail).trim(),
    ticket_type: ticketType,
    quantity: qty,
    amount_ghs: amountGhs,
    base_amount_ghs: baseAmountGhs,
    network: "paystack",
    client_reference: clientReference,
    financial_transaction_id: null,
    last_status_payload: null,
    ticket_sent_at: null,
    status: "pending",
  };
  res.status(201).json({
    ok: true,
    order,
    message: "Complete your payment in the Paystack window to confirm your order.",
  });
});

// Generates the ticket and emails it, exactly once per order (guarded by
// ticket_sent_at). Failures here don't break the status response - the
// frontend always has the /ticket.png download as a fallback.
async function maybeSendTicket(order) {
  if (order.status !== "confirmed" || order.ticket_sent_at) {
    return { attempted: false, sent: false };
  }
  if (!mailer.isConfigured()) {
    return { attempted: false, sent: false, reason: "email_not_configured" };
  }

  try {
    const png = await generateTicketPng(order);
    await mailer.sendTicketEmail(order, png);
    await db.prepare("UPDATE ticket_orders SET ticket_sent_at = datetime('now') WHERE id = ?").run(order.id);
    return { attempted: true, sent: true };
  } catch (err) {
    console.error(`Failed to email ticket for order ${order.id}:`, err.message);
    return { attempted: true, sent: false, reason: err.message };
  }
}

// GET /api/tickets/:id/status?ref=<clientReference> - polled by the frontend
// while the buyer completes the Paystack popup. If still pending in our DB,
// this actively verifies against Paystack's own record and updates
// accordingly - there's no webhook, so this poll is what actually confirms
// payment. The first poll to see 'confirmed' triggers the ticket email.
router.get("/:id/status", async (req, res) => {
  const order = await db.prepare("SELECT * FROM ticket_orders WHERE id = ?").get(req.params.id);
  if (!order || order.client_reference !== req.query.ref) {
    return res.status(404).json({ error: "Order not found" });
  }

  let current = order;
  if (order.status === "pending") {
    try {
      const result = await paystack.verifyTransaction(order.client_reference);
      // A successful Paystack transaction for a *different* amount than this
      // order expects (e.g. a tampered client-side popup call) is never
      // trusted as a real confirmation - amount_ghs was fixed server-side at
      // order creation, before any client-controlled value existed.
      const amountMatches = result.amountGhs == null || Math.abs(result.amountGhs - order.amount_ghs) < 0.01;
      const finalStatus = result.status === "confirmed" && !amountMatches ? "rejected" : result.status;

      await db.prepare(
        "UPDATE ticket_orders SET status = ?, financial_transaction_id = COALESCE(?, financial_transaction_id), last_status_payload = ? WHERE id = ?"
      ).run(finalStatus, result.transactionId, JSON.stringify(result), order.id);
      current = await db.prepare("SELECT * FROM ticket_orders WHERE id = ?").get(order.id);
    } catch (err) {
      // Paystack status check hiccup - report last known state, frontend will poll again
    }
  }

  const emailResult = await maybeSendTicket(current);
  if (emailResult.attempted) {
    current = await db.prepare("SELECT * FROM ticket_orders WHERE id = ?").get(order.id);
  }

  res.json({
    status: current.status,
    ticketType: current.ticket_type,
    quantity: current.quantity,
    amountGhs: current.amount_ghs,
    baseAmountGhs: current.base_amount_ghs,
    ticketEmailed: Boolean(current.ticket_sent_at),
    transactionId: current.financial_transaction_id,
  });
});

// GET /api/tickets/:id/ticket.png?ref=<clientReference> - lets the buyer
// download their ticket directly, regardless of whether the email send
// succeeded (e.g. email isn't configured, or landed in spam).
router.get("/:id/ticket.png", async (req, res) => {
  const order = await db.prepare("SELECT * FROM ticket_orders WHERE id = ?").get(req.params.id);
  if (!order || order.client_reference !== req.query.ref) {
    return res.status(404).json({ error: "Order not found" });
  }
  if (order.status !== "confirmed") {
    return res.status(409).json({ error: "Ticket is only available once payment is confirmed" });
  }

  try {
    const png = await generateTicketPng(order);
    res.set("Content-Type", "image/png");
    res.set("Content-Disposition", `inline; filename="${EVENT_NAME.replace(/\s+/g, "-")}-ticket-${order.id}.png"`);
    res.send(png);
  } catch (err) {
    res.status(500).json({ error: "Could not generate ticket image" });
  }
});

module.exports = router;
