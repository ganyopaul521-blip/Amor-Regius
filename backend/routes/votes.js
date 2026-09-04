const express = require("express");
const db = require("../db");
const paystack = require("../paystack");
const { EVENT_NAME } = require("../ticket");

const router = express.Router();
const VOTE_PRICE_GHS = Number(process.env.VOTE_PRICE_GHS || 1);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET /api/votes/nominees - categories with nominees and live (confirmed) vote counts
router.get("/nominees", (req, res) => {
  const categories = db.prepare("SELECT id, name FROM categories ORDER BY id").all();
  const nomineeStmt = db.prepare(
    "SELECT id, name, votes FROM nominees WHERE category_id = ? ORDER BY id"
  );
  const result = categories.map((cat) => ({
    ...cat,
    nominees: nomineeStmt.all(cat.id),
  }));
  res.json({ votePriceGhs: VOTE_PRICE_GHS, categories: result });
});

// GET /api/votes/results - leaderboard, same shape, sorted by votes desc
router.get("/results", (req, res) => {
  const categories = db.prepare("SELECT id, name FROM categories ORDER BY id").all();
  const nomineeStmt = db.prepare(
    "SELECT id, name, votes FROM nominees WHERE category_id = ? ORDER BY votes DESC, id"
  );
  const result = categories.map((cat) => ({
    ...cat,
    nominees: nomineeStmt.all(cat.id),
  }));
  res.json({ categories: result });
});

// POST /api/votes - creates a pending vote payment and hands back a
// Paystack reference for the frontend to open its payment popup with (card
// or Ghana Mobile Money, any network). Votes only count toward the nominee
// once polling (see /:id/status) verifies the payment against Paystack's
// own record.
router.post("/", async (req, res) => {
  const { nomineeId, quantity, voterName, voterPhone, voterEmail } = req.body || {};

  const qty = Number(quantity);
  if (!nomineeId || !Number.isInteger(qty) || qty < 1) {
    return res.status(400).json({ error: "nomineeId and a positive integer quantity are required" });
  }
  if (!voterEmail || !EMAIL_RE.test(String(voterEmail).trim())) {
    return res.status(400).json({ error: "A valid voterEmail is required to process payment" });
  }
  if (!paystack.isConfigured()) {
    return res.status(502).json({ error: "Payments are not configured yet. Set PAYSTACK_SECRET_KEY in backend/.env." });
  }

  const nominee = db.prepare("SELECT id, name FROM nominees WHERE id = ?").get(nomineeId);
  if (!nominee) {
    return res.status(404).json({ error: "Nominee not found" });
  }

  const baseAmountGhs = qty * VOTE_PRICE_GHS;
  // Same fee pass-through as tickets.js - the voter is charged this
  // grossed-up amount so the organizer nets exactly baseAmountGhs.
  const amountGhs = paystack.amountWithFeePassedOn(baseAmountGhs);
  const clientReference = paystack.newReferenceId();

  const insert = db
    .prepare(
      `INSERT INTO vote_payments (nominee_id, quantity, amount_ghs, base_amount_ghs, voter_name, voter_phone, voter_email, network, client_reference, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'paystack', ?, 'pending')`
    )
    .run(
      nomineeId,
      qty,
      amountGhs,
      baseAmountGhs,
      voterName || null,
      voterPhone ? String(voterPhone).trim() : null,
      String(voterEmail).trim(),
      clientReference
    );

  const paymentId = insert.lastInsertRowid;

  res.status(201).json({
    ok: true,
    paymentId,
    clientReference,
    amountGhs,
    baseAmountGhs,
    message: "Complete your payment in the Paystack window to submit your vote.",
  });
});

// GET /api/votes/:id/status?ref=<clientReference> - polled by the frontend
// while the voter completes the Paystack popup. If still pending in our DB,
// this actively verifies against Paystack's own record and, on first
// confirmation, adds the vote(s) to the nominee's tally (guarded so a repeat
// poll can't double count).
router.get("/:id/status", async (req, res) => {
  const payment = db.prepare("SELECT * FROM vote_payments WHERE id = ?").get(req.params.id);
  if (!payment || payment.client_reference !== req.query.ref) {
    return res.status(404).json({ error: "Vote payment not found" });
  }

  let current = payment;
  if (payment.status === "pending") {
    try {
      const result = await paystack.verifyTransaction(payment.client_reference);
      // Same anti-tamper guard as tickets.js - amount_ghs was fixed
      // server-side at creation, never trust a client-controlled value.
      const amountMatches = result.amountGhs == null || Math.abs(result.amountGhs - payment.amount_ghs) < 0.01;
      const finalStatus = result.status === "confirmed" && !amountMatches ? "rejected" : result.status;

      const apply = db.transaction(() => {
        if (payment.status === "pending" && finalStatus === "confirmed") {
          db.prepare("UPDATE nominees SET votes = votes + ? WHERE id = ?").run(payment.quantity, payment.nominee_id);
        }
        db.prepare(
          "UPDATE vote_payments SET status = ?, financial_transaction_id = COALESCE(?, financial_transaction_id), last_status_payload = ? WHERE id = ?"
        ).run(finalStatus, result.transactionId, JSON.stringify(result), payment.id);
      });
      apply();

      current = db.prepare("SELECT * FROM vote_payments WHERE id = ?").get(payment.id);
    } catch (err) {
      // Paystack status check hiccup - report last known state, frontend will poll again
    }
  }

  const nominee = db.prepare("SELECT id, name, votes FROM nominees WHERE id = ?").get(current.nominee_id);
  res.json({
    status: current.status,
    quantity: current.quantity,
    amountGhs: current.amount_ghs,
    baseAmountGhs: current.base_amount_ghs,
    nominee,
  });
});

module.exports = router;
