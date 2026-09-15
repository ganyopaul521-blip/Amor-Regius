// Verifies one vote-payment batch (every row created together by a single
// POST /api/votes call, sharing one client_reference) against Paystack's
// own record, and credits each nominee its own quantity on first
// confirmation. This is the ONLY place allowed to decide a vote payment's
// final status - both the frontend's live status poll and the stale-payment
// sweep call this, specifically so there is never a second implementation
// of "confirm or reject" that can drift out of sync with this one (a
// previous version of the sweep guessed rejected purely from elapsed time
// without ever asking Paystack, and wrongly killed 6 real successful
// payments before this file existed).
const db = require("./db");
const paystack = require("./paystack");

async function settleVoteBatch(clientReference) {
  const batch = await db.prepare("SELECT * FROM vote_payments WHERE client_reference = ?").all(clientReference);
  if (batch.length === 0) return null;
  if (batch[0].status !== "pending") return batch; // already settled, nothing to do

  let result;
  try {
    result = await paystack.verifyTransaction(clientReference);
  } catch (err) {
    if (err.code !== "REFERENCE_NOT_FOUND") throw err; // transient/API error - leave pending, don't guess
    // Paystack has zero record of this reference ever being used (e.g. the
    // voter closed the page before the popup opened) - no money could have
    // moved, so this is safe to mark rejected outright.
    await db.prepare("UPDATE vote_payments SET status = 'rejected' WHERE client_reference = ? AND status = 'pending'").run(clientReference);
    return db.prepare("SELECT * FROM vote_payments WHERE client_reference = ?").all(clientReference);
  }

  // Anti-tamper guard: recompute the expected total fresh from
  // base_amount_ghs (fixed server-side at creation) rather than trusting
  // any client-controlled or previously stored amount.
  const combinedBaseGhs = batch.reduce((sum, p) => sum + p.base_amount_ghs, 0);
  const expectedAmountGhs = paystack.amountWithFeePassedOn(combinedBaseGhs);
  const amountMatches = result.amountGhs == null || Math.abs(result.amountGhs - expectedAmountGhs) < 0.01;
  const finalStatus = result.status === "confirmed" && !amountMatches ? "rejected" : result.status;

  if (finalStatus === "pending") {
    // Paystack itself hasn't resolved this one way or the other yet - never
    // guess; leave it pending for the next poll or sweep to re-check.
    return batch;
  }

  const apply = db.transaction(async (db) => {
    // Atomically claim every row in this batch at once, re-checked fresh
    // against the database (status = 'pending') rather than the `batch`
    // snapshot above - closes the same race class as a stale in-memory read.
    const update = await db
      .prepare(
        "UPDATE vote_payments SET status = ?, financial_transaction_id = COALESCE(?, financial_transaction_id), last_status_payload = ? WHERE client_reference = ? AND status = 'pending'"
      )
      .run(finalStatus, result.transactionId, JSON.stringify(result), clientReference);

    if (update.changes > 0 && finalStatus === "confirmed") {
      for (const p of batch) {
        await db.prepare("UPDATE nominees SET votes = votes + ? WHERE id = ?").run(p.quantity, p.nominee_id);
      }
    }
  });
  await apply();

  return db.prepare("SELECT * FROM vote_payments WHERE client_reference = ?").all(clientReference);
}

module.exports = { settleVoteBatch };
