// Verifies one ticket order against Paystack's own record and updates its
// status accordingly. Shared by the frontend's live status poll and the
// stale-payment sweep, so there is exactly one place that can ever decide a
// ticket order's final status - a previous version of the sweep guessed
// 'rejected' purely from elapsed time without ever asking Paystack, which
// (confirmed by audit) could have silently dropped a real ticket sale the
// same way it did 6 real vote payments before this file existed.
const db = require("./db");
const paystack = require("./paystack");

async function settleTicketOrder(order) {
  if (order.status !== "pending") return order; // already settled, nothing to do

  let result;
  try {
    result = await paystack.verifyTransaction(order.client_reference);
  } catch (err) {
    if (err.code !== "REFERENCE_NOT_FOUND") throw err; // transient/API error - leave pending, don't guess
    // Paystack has zero record of this reference ever being used (e.g. the
    // buyer closed the page before the popup opened) - no money could have
    // moved, so this is safe to mark rejected outright.
    await db.prepare("UPDATE ticket_orders SET status = 'rejected' WHERE id = ?").run(order.id);
    return db.prepare("SELECT * FROM ticket_orders WHERE id = ?").get(order.id);
  }

  // A successful Paystack transaction for a *different* amount than this
  // order expects (e.g. a tampered client-side popup call) is never trusted
  // as a real confirmation - amount_ghs was fixed server-side at creation.
  const amountMatches = result.amountGhs == null || Math.abs(result.amountGhs - order.amount_ghs) < 0.01;
  const finalStatus = result.status === "confirmed" && !amountMatches ? "rejected" : result.status;

  if (finalStatus === "pending") {
    // Paystack itself hasn't resolved this one way or the other yet - never
    // guess; leave it pending for the next poll or sweep to re-check.
    return order;
  }

  await db
    .prepare(
      "UPDATE ticket_orders SET status = ?, financial_transaction_id = COALESCE(?, financial_transaction_id), last_status_payload = ? WHERE id = ?"
    )
    .run(finalStatus, result.transactionId, JSON.stringify(result), order.id);

  return db.prepare("SELECT * FROM ticket_orders WHERE id = ?").get(order.id);
}

module.exports = { settleTicketOrder };
