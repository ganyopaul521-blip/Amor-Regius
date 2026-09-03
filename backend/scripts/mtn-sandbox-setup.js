// One-time helper to self-provision a sandbox API User + API Key with MTN's
// MoMo Developer Portal. Run this once, then copy the printed values into
// backend/.env. Production credentials work differently - see README.md.
//
// Usage:
//   MTN_SUBSCRIPTION_KEY=xxxx node scripts/mtn-sandbox-setup.js
require("dotenv").config();
const crypto = require("crypto");

const BASE_URL = "https://sandbox.momodeveloper.mtn.com";
const subscriptionKey = process.env.MTN_SUBSCRIPTION_KEY;

if (!subscriptionKey) {
  console.error("Set MTN_SUBSCRIPTION_KEY (your sandbox 'Collections' product subscription key) first.");
  console.error("Get it from https://momodeveloper.mtn.com after subscribing to the Collections product.");
  process.exit(1);
}

async function main() {
  const apiUser = crypto.randomUUID();

  const createUserRes = await fetch(`${BASE_URL}/v1_0/apiuser`, {
    method: "POST",
    headers: {
      "X-Reference-Id": apiUser,
      "Ocp-Apim-Subscription-Key": subscriptionKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      // Not used since we poll for status rather than relying on a webhook,
      // but MTN requires some value here.
      providerCallbackHost: "example.com",
    }),
  });

  if (createUserRes.status !== 201) {
    throw new Error(`Failed to create API user (HTTP ${createUserRes.status}): ${await createUserRes.text()}`);
  }

  const createKeyRes = await fetch(`${BASE_URL}/v1_0/apiuser/${apiUser}/apikey`, {
    method: "POST",
    headers: { "Ocp-Apim-Subscription-Key": subscriptionKey },
  });

  if (createKeyRes.status !== 201) {
    throw new Error(`Failed to create API key (HTTP ${createKeyRes.status}): ${await createKeyRes.text()}`);
  }

  const { apiKey } = await createKeyRes.json();

  console.log("\nSandbox API user created. Add these to backend/.env:\n");
  console.log(`MTN_API_USER=${apiUser}`);
  console.log(`MTN_API_KEY=${apiKey}`);
  console.log(`MTN_SUBSCRIPTION_KEY=${subscriptionKey}`);
  console.log(`MTN_BASE_URL=${BASE_URL}`);
  console.log(`MTN_TARGET_ENVIRONMENT=sandbox`);
  console.log(`MTN_CURRENCY=EUR`);
  console.log("\n(Sandbox only accepts EUR as the currency - this is normal, not a bug.)");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
