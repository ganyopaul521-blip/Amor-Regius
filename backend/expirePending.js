// Sweeps ticket_orders and vote_payments for anything still 'pending' more
// than STALE_AFTER_MINUTES after creation - nothing else ever revisits a
// pending row once the frontend's own 90s polling window gives up (e.g. a
// buyer closes the Paystack popup without finishing).
//
// Critically, this does NOT guess a payment's fate from elapsed time alone.
// An earlier version did exactly that (blindly setting status = 'rejected'
// on anything stale), and a live audit found it had wrongly killed 6 real,
// successful vote payments that simply took longer than the threshold to
// complete - the money was taken, but no vote was ever credited. Every
// stale row here goes through the same settleTicketOrder/settleVoteBatch
// functions the live status poll uses, which actually ask Paystack what
// really happened before deciding anything.
const db = require("./db");
const { settleTicketOrder } = require("./ticketSettlement");
const { settleVoteBatch } = require("./voteSettlement");

const STALE_AFTER_MINUTES = 3;

async function sweepStaleTicketOrders() {
  const stale = await db
    .prepare(`SELECT * FROM ticket_orders WHERE status = 'pending' AND created_at < datetime('now', ?)`)
    .all(`-${STALE_AFTER_MINUTES} minutes`);

  let confirmed = 0;
  let rejected = 0;
  for (const order of stale) {
    try {
      const settled = await settleTicketOrder(order);
      if (settled.status === "confirmed") confirmed++;
      else if (settled.status === "rejected") rejected++;
    } catch (err) {
      console.error(`Failed to settle stale ticket order ${order.id}:`, err.message);
    }
  }
  return { confirmed, rejected };
}

async function sweepStaleVotePayments() {
  const stale = await db
    .prepare(`SELECT DISTINCT client_reference FROM vote_payments WHERE status = 'pending' AND created_at < datetime('now', ?)`)
    .all(`-${STALE_AFTER_MINUTES} minutes`);

  let confirmed = 0;
  let rejected = 0;
  for (const row of stale) {
    try {
      const settled = await settleVoteBatch(row.client_reference);
      if (settled?.[0]?.status === "confirmed") confirmed++;
      else if (settled?.[0]?.status === "rejected") rejected++;
    } catch (err) {
      console.error(`Failed to settle stale vote batch ${row.client_reference}:`, err.message);
    }
  }
  return { confirmed, rejected };
}

async function expireStalePending() {
  const tickets = await sweepStaleTicketOrders();
  const votes = await sweepStaleVotePayments();

  if (tickets.confirmed + tickets.rejected > 0) {
    await db
      .prepare("INSERT INTO admin_activity (action, detail) VALUES (?, ?)")
      .run(
        "Stale ticket orders settled",
        `${tickets.confirmed} confirmed (were actually paid), ${tickets.rejected} rejected, after being stuck pending > ${STALE_AFTER_MINUTES}min`
      );
  }
  if (votes.confirmed + votes.rejected > 0) {
    await db
      .prepare("INSERT INTO admin_activity (action, detail) VALUES (?, ?)")
      .run(
        "Stale vote payments settled",
        `${votes.confirmed} confirmed (were actually paid), ${votes.rejected} rejected, after being stuck pending > ${STALE_AFTER_MINUTES}min`
      );
  }
}

function startExpiryLoop() {
  expireStalePending().catch((err) => console.error("expireStalePending failed:", err.message));
  setInterval(() => {
    expireStalePending().catch((err) => console.error("expireStalePending failed:", err.message));
  }, 60_000);
}

module.exports = { startExpiryLoop };
