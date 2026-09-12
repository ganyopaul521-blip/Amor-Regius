// Sweeps ticket_orders and vote_payments for anything still 'pending' more
// than 10 minutes after creation and marks it 'rejected'. Nothing else ever
// revisits a pending row once the frontend's own 90s polling window gives
// up (e.g. a buyer closes the Paystack popup without finishing) - without
// this, an abandoned payment would stay "pending" forever.
const db = require("./db");

const STALE_AFTER_MINUTES = 3;

async function expireStalePending() {
  const tickets = await db
    .prepare(
      `UPDATE ticket_orders SET status = 'rejected'
       WHERE status = 'pending' AND created_at < datetime('now', ?)`
    )
    .run(`-${STALE_AFTER_MINUTES} minutes`);

  const votes = await db
    .prepare(
      `UPDATE vote_payments SET status = 'rejected'
       WHERE status = 'pending' AND created_at < datetime('now', ?)`
    )
    .run(`-${STALE_AFTER_MINUTES} minutes`);

  if (tickets.changes > 0) {
    await db
      .prepare("INSERT INTO admin_activity (action, detail) VALUES (?, ?)")
      .run("Stale ticket orders auto-rejected", `${tickets.changes} order(s) pending > ${STALE_AFTER_MINUTES}min`);
  }
  if (votes.changes > 0) {
    await db
      .prepare("INSERT INTO admin_activity (action, detail) VALUES (?, ?)")
      .run("Stale vote payments auto-rejected", `${votes.changes} payment(s) pending > ${STALE_AFTER_MINUTES}min`);
  }
}

function startExpiryLoop() {
  expireStalePending().catch((err) => console.error("expireStalePending failed:", err.message));
  setInterval(() => {
    expireStalePending().catch((err) => console.error("expireStalePending failed:", err.message));
  }, 60_000);
}

module.exports = { startExpiryLoop };
