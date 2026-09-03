// Direct integration with MTN's own MoMo Open API (Collections product) -
// no aggregator in the middle, funds settle straight into your MTN MoMo
// merchant/collection account. Docs: https://momodeveloper.mtn.com
//
// Because this is a direct telco API (not an aggregator like Hubtel), it can
// ONLY charge MTN Mobile Money numbers. Vodafone/Telecel and AirtelTigo
// customers cannot be charged this way.
//
// Unlike a webhook-based flow, status is checked by polling MTN's own GET
// endpoint (see getStatus below) - so no public callback URL is needed at
// all, even in production.

const crypto = require("crypto");

function isConfigured() {
  return Boolean(
    process.env.MTN_SUBSCRIPTION_KEY &&
      process.env.MTN_API_USER &&
      process.env.MTN_API_KEY &&
      process.env.MTN_BASE_URL &&
      process.env.MTN_TARGET_ENVIRONMENT
  );
}

function baseUrl() {
  return process.env.MTN_BASE_URL.replace(/\/$/, "");
}

function subscriptionKey() {
  return process.env.MTN_SUBSCRIPTION_KEY;
}

function targetEnvironment() {
  return process.env.MTN_TARGET_ENVIRONMENT;
}

// Sandbox only accepts "EUR" regardless of country, by MTN's own design -
// this is not a bug. Real Ghana production traffic must use "GHS".
function currency() {
  return process.env.MTN_CURRENCY || "EUR";
}

// MTN's sandbox silently rejects (WAF-level, HTTP 200 with an HTML "Request
// Rejected" body - not a documented API error) any payerMessage/payeeNote
// containing '(' ')' or '#'. Strip them from any text that includes
// user/admin-entered content (e.g. a nominee name) before sending.
function sanitizeNote(text) {
  return String(text).replace(/[()#]/g, "");
}

// MTN's API requires the MSISDN in full international format with no
// leading '+' and no leading '0' - e.g. Ghana's 0551234567 -> 233551234567.
function normalizeGhanaMsisdn(phone) {
  const digits = String(phone).replace(/\D/g, "");
  if (digits.startsWith("233")) return digits;
  if (digits.startsWith("0")) return `233${digits.slice(1)}`;
  return `233${digits}`;
}

let cachedToken = null; // { accessToken, expiresAt }

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.accessToken;
  }

  const auth = Buffer.from(`${process.env.MTN_API_USER}:${process.env.MTN_API_KEY}`).toString("base64");
  const res = await fetch(`${baseUrl()}/collection/token/`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Ocp-Apim-Subscription-Key": subscriptionKey(),
      "X-Target-Environment": targetEnvironment(),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`MTN MoMo auth failed (HTTP ${res.status}): ${text}`);
  }

  const data = await res.json();
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };
  return cachedToken.accessToken;
}

// Initiates a "request to pay" - this only confirms MTN *accepted* the
// request (HTTP 202, empty body). The customer still has to approve the
// prompt on their phone. Call getStatus(referenceId) afterwards (poll it)
// to find out what actually happened.
async function requestToPay({ referenceId, msisdn, amountGhs, externalId, payerMessage, payeeNote }) {
  if (!isConfigured()) {
    throw new Error(
      "MTN MoMo is not configured yet. Set MTN_SUBSCRIPTION_KEY, MTN_API_USER, MTN_API_KEY, MTN_BASE_URL, and MTN_TARGET_ENVIRONMENT in backend/.env."
    );
  }

  const token = await getAccessToken();
  const res = await fetch(`${baseUrl()}/collection/v1_0/requesttopay`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Reference-Id": referenceId,
      "X-Target-Environment": targetEnvironment(),
      "Ocp-Apim-Subscription-Key": subscriptionKey(),
    },
    body: JSON.stringify({
      amount: String(amountGhs),
      currency: currency(),
      externalId,
      payer: {
        partyIdType: "MSISDN",
        partyId: normalizeGhanaMsisdn(msisdn),
      },
      payerMessage,
      payeeNote,
    }),
  });

  if (res.status !== 202) {
    const text = await res.text().catch(() => "");
    throw new Error(`MTN MoMo request-to-pay failed (HTTP ${res.status}): ${text}`);
  }
}

// Polls the live status of a previously initiated request-to-pay.
// Returns { status: 'pending' | 'confirmed' | 'rejected', financialTransactionId, reason }
async function getStatus(referenceId) {
  const token = await getAccessToken();
  const res = await fetch(`${baseUrl()}/collection/v1_0/requesttopay/${referenceId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Target-Environment": targetEnvironment(),
      "Ocp-Apim-Subscription-Key": subscriptionKey(),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`MTN MoMo status check failed (HTTP ${res.status}): ${text}`);
  }

  const data = await res.json();
  const status = data.status === "SUCCESSFUL" ? "confirmed" : data.status === "FAILED" ? "rejected" : "pending";
  return { status, financialTransactionId: data.financialTransactionId || null, reason: data.reason || null };
}

function newReferenceId() {
  return crypto.randomUUID();
}

module.exports = { isConfigured, requestToPay, getStatus, newReferenceId, normalizeGhanaMsisdn, sanitizeNote };
