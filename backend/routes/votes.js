const express = require("express");
const db = require("../db");
const paystack = require("../paystack");
const { EVENT_NAME } = require("../ticket");

const router = express.Router();
const VOTE_PRICE_GHS = Number(process.env.VOTE_PRICE_GHS || 1);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET /api/votes/nominees - categories with nominees and live (confirmed) vote counts
router.get("/nominees", async (req, res) => {
  const categories = await db.prepare("SELECT id, name FROM categories ORDER BY id").all();
  const nomineeStmt = db.prepare(
    "SELECT id, name, votes FROM nominees WHERE category_id = ? ORDER BY id"
  );
  const result = await Promise.all(
    categories.map(async (cat) => ({ ...cat, nominees: await nomineeStmt.all(cat.id) }))
  );
  res.json({ votePriceGhs: VOTE_PRICE_GHS, categories: result });
});

// GET /api/votes/results - leaderboard, same shape, sorted by votes desc
router.get("/results", async (req, res) => {
  const categories = await db.prepare("SELECT id, name FROM categories ORDER BY id").all();
  const nomineeStmt = db.prepare(
    "SELECT id, name, votes FROM nominees WHERE category_id = ? ORDER BY votes DESC, id"
  );
  const result = await Promise.all(
    categories.map(async (cat) => ({ ...cat, nominees: await nomineeStmt.all(cat.id) }))
  );
  res.json({ categories: result });
});

// POST /api/votes - creates one pending vote_payments row per selected
// nominee (e.g. one per award category), all sharing a single Paystack
// reference so the voter pays once for every selection combined - still
// exactly VOTE_PRICE_GHS per vote, just totalled across every selection
// instead of one nominee at a time. Votes only count once polling (see
// /status) verifies the combined payment against Paystack's own record.
router.post("/", async (req, res) => {
  const { selections, voterName, voterPhone, voterEmail } = req.body || {};

  if (!Array.isArray(selections) || selections.length === 0) {
    return res.status(400).json({ error: "At least one nominee selection is required" });
  }
  const seenNomineeIds = new Set();
  for (const sel of selections) {
    const qty = Number(sel?.quantity);
    if (!sel?.nomineeId || !Number.isInteger(qty) || qty < 1 || qty > 1000) {
      return res.status(400).json({ error: "Each selection needs a nomineeId and a quantity between 1 and 1000" });
    }
    if (seenNomineeIds.has(sel.nomineeId)) {
      return res.status(400).json({ error: "Each nominee can only appear once per submission" });
    }
    seenNomineeIds.add(sel.nomineeId);
  }
  if (!voterEmail || !EMAIL_RE.test(String(voterEmail).trim())) {
    return res.status(400).json({ error: "A valid voterEmail is required to process payment" });
  }
  if (!paystack.isConfigured()) {
    return res.status(502).json({ error: "Payments are not configured yet. Set PAYSTACK_SECRET_KEY in backend/.env." });
  }

  const nominees = await db
    .prepare(`SELECT id, name FROM nominees WHERE id IN (${selections.map(() => "?").join(",")})`)
    .all(...selections.map((s) => s.nomineeId));
  if (nominees.length !== selections.length) {
    return res.status(404).json({ error: "One or more nominees were not found" });
  }
  const nomineeById = new Map(nominees.map((n) => [n.id, n]));

  const combinedBaseGhs = selections.reduce((sum, s) => sum + Number(s.quantity) * VOTE_PRICE_GHS, 0);
  // The fee is grossed up once on the combined total (one Paystack charge
  // for the whole batch), then each row gets its proportional share - purely
  // for display/reporting, since confirmation re-derives the true total
  // fresh from base_amount_ghs rather than trusting any stored amount_ghs.
  const combinedAmountGhs = paystack.amountWithFeePassedOn(combinedBaseGhs);
  const clientReference = paystack.newReferenceId();

  const created = [];
  for (const sel of selections) {
    const qty = Number(sel.quantity);
    const baseAmountGhs = qty * VOTE_PRICE_GHS;
    const amountGhs = Math.round(combinedAmountGhs * (baseAmountGhs / combinedBaseGhs) * 100) / 100;
    const insert = await db
      .prepare(
        `INSERT INTO vote_payments (nominee_id, quantity, amount_ghs, base_amount_ghs, voter_name, voter_phone, voter_email, network, client_reference, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'paystack', ?, 'pending')`
      )
      .run(
        sel.nomineeId,
        qty,
        amountGhs,
        baseAmountGhs,
        voterName || null,
        voterPhone ? String(voterPhone).trim() : null,
        String(voterEmail).trim(),
        clientReference
      );
    created.push({ paymentId: insert.lastInsertRowid, nomineeId: sel.nomineeId, nomineeName: nomineeById.get(sel.nomineeId).name, quantity: qty });
  }

  res.status(201).json({
    ok: true,
    clientReference,
    amountGhs: combinedAmountGhs,
    baseAmountGhs: combinedBaseGhs,
    selections: created,
    message: "Complete your payment in the Paystack window to submit your votes.",
  });
});

// GET /api/votes/status?ref=<clientReference> - polled by the frontend while
// the voter completes the Paystack popup. All vote_payments rows created
// together in one POST /api/votes call share this same reference, so they
// verify and confirm together as one unit - either every selection in the
// batch counts, or none of them do.
router.get("/status", async (req, res) => {
  const ref = req.query.ref;
  if (!ref) {
    return res.status(400).json({ error: "ref is required" });
  }

  const batch = await db.prepare("SELECT * FROM vote_payments WHERE client_reference = ?").all(ref);
  if (batch.length === 0) {
    return res.status(404).json({ error: "Vote payment not found" });
  }

  let current = batch;
  if (batch[0].status === "pending") {
    try {
      const result = await paystack.verifyTransaction(ref);
      // Anti-tamper guard, same principle as tickets.js: recompute the
      // expected total fresh from base_amount_ghs (fixed server-side at
      // creation) rather than trusting any client-controlled or previously
      // stored amount - never trust a single row's amount_ghs share alone,
      // since rounding could make individual shares an imprecise match.
      const combinedBaseGhs = batch.reduce((sum, p) => sum + p.base_amount_ghs, 0);
      const expectedAmountGhs = paystack.amountWithFeePassedOn(combinedBaseGhs);
      const amountMatches = result.amountGhs == null || Math.abs(result.amountGhs - expectedAmountGhs) < 0.01;
      const finalStatus = result.status === "confirmed" && !amountMatches ? "rejected" : result.status;

      const apply = db.transaction(async (db) => {
        // Atomically claim every row in this batch at once - re-checked
        // fresh against the database (status = 'pending'), not the `batch`
        // snapshot read above, closing the same race class fixed for the
        // single-nominee flow. One statement covers the whole batch since
        // they all share this client_reference.
        const update = await db
          .prepare(
            "UPDATE vote_payments SET status = ?, financial_transaction_id = COALESCE(?, financial_transaction_id), last_status_payload = ? WHERE client_reference = ? AND status = 'pending'"
          )
          .run(finalStatus, result.transactionId, JSON.stringify(result), ref);

        if (update.changes > 0 && finalStatus === "confirmed") {
          for (const p of batch) {
            await db.prepare("UPDATE nominees SET votes = votes + ? WHERE id = ?").run(p.quantity, p.nominee_id);
          }
        }
      });
      await apply();

      current = await db.prepare("SELECT * FROM vote_payments WHERE client_reference = ?").all(ref);
    } catch (err) {
      // Paystack status check hiccup - report last known state, frontend will poll again
    }
  }

  const nominees = await Promise.all(
    current.map((p) => db.prepare("SELECT id, name, votes FROM nominees WHERE id = ?").get(p.nominee_id))
  );

  res.json({
    status: current[0].status,
    amountGhs: Math.round(current.reduce((sum, p) => sum + p.amount_ghs, 0) * 100) / 100,
    baseAmountGhs: Math.round(current.reduce((sum, p) => sum + p.base_amount_ghs, 0) * 100) / 100,
    selections: current.map((p, i) => ({ quantity: p.quantity, nominee: nominees[i] })),
  });
});

module.exports = router;
