const express = require("express");
const db = require("../db");
const mtn = require("../mtnMomo");
const { EVENT_NAME } = require("../ticket");

const router = express.Router();
const VOTE_PRICE_GHS = Number(process.env.VOTE_PRICE_GHS || 1);

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

// POST /api/votes - creates a pending vote payment and asks MTN MoMo to push
// a payment prompt to the voter's phone. Votes only count toward the
// nominee once polling (see /:id/status) reports MTN's payment as successful.
router.post("/", async (req, res) => {
  const { nomineeId, quantity, voterName, voterPhone } = req.body || {};

  const qty = Number(quantity);
  if (!nomineeId || !Number.isInteger(qty) || qty < 1) {
    return res.status(400).json({ error: "nomineeId and a positive integer quantity are required" });
  }
  if (!voterPhone || !String(voterPhone).trim()) {
    return res.status(400).json({ error: "voterPhone is required to charge mobile money" });
  }

  const nominee = db.prepare("SELECT id, name FROM nominees WHERE id = ?").get(nomineeId);
  if (!nominee) {
    return res.status(404).json({ error: "Nominee not found" });
  }

  const amountGhs = qty * VOTE_PRICE_GHS;
  const clientReference = mtn.newReferenceId();

  const insert = db
    .prepare(
      `INSERT INTO vote_payments (nominee_id, quantity, amount_ghs, voter_name, voter_phone, network, client_reference, status)
       VALUES (?, ?, ?, ?, ?, 'mtn-gh', ?, 'pending')`
    )
    .run(nomineeId, qty, amountGhs, voterName || null, String(voterPhone).trim(), clientReference);

  const paymentId = insert.lastInsertRowid;

  try {
    await mtn.requestToPay({
      referenceId: clientReference,
      msisdn: String(voterPhone).trim(),
      amountGhs,
      externalId: `VOTE-${paymentId}`,
      // MTN's sandbox rejects payerMessage/payeeNote containing '(' ')' or
      // '#' (a WAF-level block, confirmed by testing - not documented
      // anywhere), hence sanitizeNote() on the nominee's (admin-entered) name.
      payerMessage: `${EVENT_NAME} - ${qty} vote for ${mtn.sanitizeNote(nominee.name)}`,
      payeeNote: `Vote payment ${paymentId}`,
    });

    res.status(201).json({
      ok: true,
      paymentId,
      clientReference,
      amountGhs,
      message: "Check your phone and approve the MTN Mobile Money payment prompt.",
    });
  } catch (err) {
    db.prepare("UPDATE vote_payments SET status = 'rejected' WHERE id = ?").run(paymentId);
    res.status(502).json({ error: err.message || "Could not start the mobile money payment" });
  }
});

// GET /api/votes/:id/status?ref=<clientReference> - polled by the frontend
// while the voter approves the prompt on their phone. If still pending in
// our DB, this actively checks MTN's live status and, on first confirmation,
// adds the vote(s) to the nominee's tally (guarded so a repeat poll can't
// double count).
router.get("/:id/status", async (req, res) => {
  const payment = db.prepare("SELECT * FROM vote_payments WHERE id = ?").get(req.params.id);
  if (!payment || payment.client_reference !== req.query.ref) {
    return res.status(404).json({ error: "Vote payment not found" });
  }

  let current = payment;
  if (payment.status === "pending") {
    try {
      const result = await mtn.getStatus(payment.client_reference);

      const apply = db.transaction(() => {
        if (payment.status === "pending" && result.status === "confirmed") {
          db.prepare("UPDATE nominees SET votes = votes + ? WHERE id = ?").run(payment.quantity, payment.nominee_id);
        }
        db.prepare(
          "UPDATE vote_payments SET status = ?, financial_transaction_id = COALESCE(?, financial_transaction_id), last_status_payload = ? WHERE id = ?"
        ).run(result.status, result.financialTransactionId, JSON.stringify(result), payment.id);
      });
      apply();

      current = db.prepare("SELECT * FROM vote_payments WHERE id = ?").get(payment.id);
    } catch (err) {
      // MTN status check hiccup - report last known state, frontend will poll again
    }
  }

  const nominee = db.prepare("SELECT id, name, votes FROM nominees WHERE id = ?").get(current.nominee_id);
  res.json({ status: current.status, quantity: current.quantity, amountGhs: current.amount_ghs, nominee });
});

module.exports = router;
