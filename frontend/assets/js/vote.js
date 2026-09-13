let votePrice = 1;
let selectedNomineeId = null;
let selectedNomineeName = "";
let quantity = 1;
let pollTimer = null;
let paystackPublicKey = null;
let paystackFeeRate = 0;

// Needed before the Paystack popup can open - fetched once on page load.
// paystackFeeRate lets the summary show the same fee-inclusive total the
// backend will actually charge (the backend independently recomputes and
// charges this itself - this is only for display, never trusted for payment).
async function loadPaystackKey() {
  try {
    const cfg = await apiGet("/config");
    paystackPublicKey = cfg.paystackPublicKey;
    paystackFeeRate = cfg.paystackFeeRate || 0;
    updateSummary();
  } catch (err) {
    // handled at submit time if still null
  }
}
loadPaystackKey();

function amountWithFeePassedOn(netGhs) {
  return Math.round((netGhs / (1 - paystackFeeRate)) * 100) / 100;
}

const categoriesEl = document.getElementById("categories");
const selectedNomineeEl = document.getElementById("selected-nominee");
const qtyValueEl = document.getElementById("qty-value");
const summarySubtotalEl = document.getElementById("summary-subtotal");
const summaryFeeEl = document.getElementById("summary-fee");
const summaryTotalEl = document.getElementById("summary-total");
const alertEl = document.getElementById("vote-alert");
const form = document.getElementById("vote-form");
const submitBtn = document.getElementById("submit-btn");
const statusBox = document.getElementById("payment-status");
const statusText = document.getElementById("payment-status-text");

function updateSummary() {
  const subtotal = votePrice * quantity;
  const total = amountWithFeePassedOn(subtotal);
  const fee = Math.round((total - subtotal) * 100) / 100;

  summarySubtotalEl.textContent = `GHS ${subtotal.toFixed(2)}`;
  summaryFeeEl.textContent = `GHS ${fee.toFixed(2)}`;
  summaryTotalEl.textContent = `GHS ${total.toFixed(2)}`;
}

function showAlert(message, type) {
  alertEl.innerHTML = `<div class="alert ${type}">${message}</div>`;
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function renderCategories(categories) {
  // Vote counts/standings are deliberately not shown here - only admins can
  // see totals, via the admin dashboard's Voting section.
  categoriesEl.innerHTML = "";
  categories.forEach((cat) => {
    const block = document.createElement("div");
    block.className = "category-block";

    const heading = document.createElement("h3");
    heading.textContent = cat.name;
    block.appendChild(heading);

    cat.nominees.forEach((nominee) => {
      const row = document.createElement("div");
      row.className = "nominee-row";
      row.dataset.id = nominee.id;
      row.dataset.name = nominee.name;
      if (nominee.id === selectedNomineeId) row.classList.add("selected");

      row.innerHTML = `<span class="name">${nominee.name}</span>`;

      row.addEventListener("click", () => {
        selectedNomineeId = nominee.id;
        selectedNomineeName = nominee.name;
        document.querySelectorAll(".nominee-row").forEach((r) => r.classList.remove("selected"));
        row.classList.add("selected");
        selectedNomineeEl.textContent = `${nominee.name} — ${cat.name}`;
      });

      block.appendChild(row);
    });

    categoriesEl.appendChild(block);
  });
}

async function loadNominees() {
  try {
    const data = await apiGet("/votes/nominees");
    votePrice = data.votePriceGhs;
    document.getElementById("vote-price").textContent = `GHS ${votePrice}`;
    renderCategories(data.categories);
    updateSummary();
  } catch (err) {
    categoriesEl.innerHTML = `<div class="alert error">Could not load nominees. Is the backend running?</div>`;
  }
}

const MAX_VOTES = 1000;

document.getElementById("qty-minus").addEventListener("click", () => {
  quantity = Math.max(1, quantity - 1);
  qtyValueEl.value = quantity;
  updateSummary();
});

document.getElementById("qty-plus").addEventListener("click", () => {
  quantity = Math.min(MAX_VOTES, quantity + 1);
  qtyValueEl.value = quantity;
  updateSummary();
});

// Lets a voter type an exact number directly instead of only stepping one
// at a time - clamped to the same 1-1000 range, falling back to 1 for
// anything invalid (empty, non-numeric, negative) rather than accepting it.
qtyValueEl.addEventListener("input", () => {
  const parsed = parseInt(qtyValueEl.value, 10);
  quantity = Number.isFinite(parsed) ? Math.min(MAX_VOTES, Math.max(1, parsed)) : 1;
  updateSummary();
});

qtyValueEl.addEventListener("blur", () => {
  qtyValueEl.value = quantity;
});

function resetForm() {
  form.reset();
  selectedNomineeId = null;
  selectedNomineeName = "";
  quantity = 1;
  qtyValueEl.value = "1";
  selectedNomineeEl.textContent = "None selected yet — click a nominee above.";
  updateSummary();
}

function pollPaymentStatus(paymentId, clientReference) {
  const startedAt = Date.now();
  const TIMEOUT_MS = 90_000;

  pollTimer = setInterval(async () => {
    if (Date.now() - startedAt > TIMEOUT_MS) {
      stopPolling();
      statusText.textContent =
        "Still waiting for confirmation. If you completed the payment, your vote will count shortly.";
      submitBtn.disabled = false;
      submitBtn.textContent = "Pay Now";
      return;
    }

    try {
      const data = await apiGet(`/votes/${paymentId}/status?ref=${encodeURIComponent(clientReference)}`);
      if (data.status === "confirmed") {
        stopPolling();
        statusBox.classList.add("hidden");
        showAlert(
          `Payment confirmed! ${data.quantity} vote(s) for "${data.nominee.name}" recorded.`,
          "success"
        );
        resetForm();
        submitBtn.disabled = false;
        submitBtn.textContent = "Pay Now";
        loadNominees();
      } else if (data.status === "rejected") {
        stopPolling();
        statusBox.classList.add("hidden");
        showAlert("Payment was not completed. Please try again.", "error");
        submitBtn.disabled = false;
        submitBtn.textContent = "Pay Now";
      }
      // status still 'pending' -> keep polling
    } catch (err) {
      // transient network hiccup - keep polling until timeout
    }
  }, 3000);
}

function resetSubmitUi() {
  statusBox.classList.add("hidden");
  submitBtn.disabled = false;
  submitBtn.textContent = "Pay Now";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  alertEl.innerHTML = "";

  if (!selectedNomineeId) {
    showAlert("Please select a nominee first.", "error");
    return;
  }
  if (!paystackPublicKey) {
    showAlert("Payments are not available right now. Please try again shortly.", "error");
    return;
  }

  const voterName = document.getElementById("voterName").value.trim();
  const voterEmail = document.getElementById("voterEmail").value.trim();
  const voterPhone = document.getElementById("voterPhone").value.trim();

  submitBtn.disabled = true;
  submitBtn.textContent = "Preparing vote...";

  try {
    const { paymentId, clientReference, amountGhs } = await apiPost("/votes", {
      nomineeId: selectedNomineeId,
      quantity,
      voterName,
      voterEmail,
      voterPhone,
    });

    const handler = PaystackPop.setup({
      key: paystackPublicKey,
      email: voterEmail,
      amount: Math.round(amountGhs * 100),
      currency: "GHS",
      ref: clientReference,
      metadata: { paymentId, nomineeId: selectedNomineeId, voterName },
      callback: function () {
        statusBox.classList.remove("hidden");
        statusText.textContent = `Confirming your payment... (GHS ${amountGhs})`;
        submitBtn.textContent = "Confirming payment...";
        pollPaymentStatus(paymentId, clientReference);
      },
      onClose: function () {
        resetSubmitUi();
      },
    });
    handler.openIframe();
    submitBtn.textContent = "Waiting for payment window...";
  } catch (err) {
    showAlert(err.message || "Something went wrong. Please try again.", "error");
    resetSubmitUi();
  }
});

loadNominees();
