// Paystack integration (Inline Popup flow) - the customer pays through
// Paystack's own hosted popup, right on top of this site (card or Ghana
// Mobile Money - MTN, Vodafone Cash, AirtelTigo, all supported by Paystack
// directly, unlike the old MTN-only direct integration). The frontend opens
// the popup using the public key below; this module's job is to verify the
// result server-side afterwards - the frontend's own claim that payment
// succeeded is never trusted on its own. Docs: https://paystack.com/docs

const crypto = require("crypto");

function isConfigured() {
  return Boolean(process.env.PAYSTACK_SECRET_KEY);
}

function publicKey() {
  return process.env.PAYSTACK_PUBLIC_KEY || null;
}

// Looks up a transaction by the reference the popup was opened with. This is
// the authoritative source of truth for whether money actually moved -
// amountGhs here is what Paystack actually recorded as paid, for the caller
// to compare against the order's expected amount before trusting it.
async function verifyTransaction(reference) {
  if (!isConfigured()) {
    throw new Error("Paystack is not configured yet. Set PAYSTACK_SECRET_KEY in backend/.env.");
  }

  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Paystack verify failed (HTTP ${res.status}): ${body.message || "unknown error"}`);
  }

  const data = body.data || {};
  // Paystack's transaction status can be several strings depending on
  // channel (success/failed/abandoned/reversed/queued/pending/processing/
  // ongoing) - only a hard failure counts as rejected, everything else that
  // isn't a confirmed success keeps the frontend polling.
  const FAILED_STATUSES = new Set(["failed", "reversed"]);
  const status = data.status === "success" ? "confirmed" : FAILED_STATUSES.has(data.status) ? "rejected" : "pending";

  return {
    status,
    amountGhs: typeof data.amount === "number" ? data.amount / 100 : null,
    currency: data.currency || null,
    channel: data.channel || null,
    transactionId: data.id != null ? String(data.id) : null,
    raw: data,
  };
}

function newReferenceId() {
  return crypto.randomUUID();
}

module.exports = { isConfigured, publicKey, verifyTransaction, newReferenceId };
