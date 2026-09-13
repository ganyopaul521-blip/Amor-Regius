let votePrice = 1;
let quantity = 1;
let pollTimer = null;
let paystackPublicKey = null;
let paystackFeeRate = 0;

// categoryId -> { nomineeId, nomineeName, categoryName } - one nominee per
// category, but any number of categories can be selected at once so a
// voter can cover several award categories in a single payment.
const selectedByCategory = new Map();

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
const selectedNomineesEl = document.getElementById("selected-nominees");
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
  const subtotal = votePrice * quantity * selectedByCategory.size;
  const total = amountWithFeePassedOn(subtotal);
  const fee = Math.round((total - subtotal) * 100) / 100;

  summarySubtotalEl.textContent = `GHS ${subtotal.toFixed(2)}`;
  summaryFeeEl.textContent = `GHS ${fee.toFixed(2)}`;
  summaryTotalEl.textContent = `GHS ${total.toFixed(2)}`;

  if (selectedByCategory.size === 0) {
    selectedNomineesEl.textContent = "None selected yet — click a nominee above.";
  } else {
    selectedNomineesEl.innerHTML = [...selectedByCategory.values()]
      .map((s) => `<div>${s.nomineeName} — <span class="muted">${s.categoryName}</span></div>`)
      .join("");
  }
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
      if (selectedByCategory.get(cat.id)?.nomineeId === nominee.id) row.classList.add("selected");

      row.innerHTML = `<span class="name">${nominee.name}</span>`;

      row.addEventListener("click", () => {
        const current = selectedByCategory.get(cat.id);
        const rowsInCategory = block.querySelectorAll(".nominee-row");
        if (current?.nomineeId === nominee.id) {
          // clicking the already-selected nominee again deselects this category
          selectedByCategory.delete(cat.id);
          row.classList.remove("selected");
        } else {
          selectedByCategory.set(cat.id, { nomineeId: nominee.id, nomineeName: nominee.name, categoryName: cat.name });
          rowsInCategory.forEach((r) => r.classList.remove("selected"));
          row.classList.add("selected");
        }
        updateSummary();
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
  selectedByCategory.clear();
  quantity = 1;
  qtyValueEl.value = "1";
  updateSummary();
}

function resetSubmitUi() {
  statusBox.classList.add("hidden");
  submitBtn.disabled = false;
  submitBtn.textContent = "Pay Now";
}

function pollPaymentStatus(clientReference) {
  const startedAt = Date.now();
  const TIMEOUT_MS = 90_000;

  pollTimer = setInterval(async () => {
    if (Date.now() - startedAt > TIMEOUT_MS) {
      stopPolling();
      statusText.textContent =
        "Still waiting for confirmation. If you completed the payment, your vote(s) will count shortly.";
      submitBtn.disabled = false;
      submitBtn.textContent = "Pay Now";
      return;
    }

    try {
      const data = await apiGet(`/votes/status?ref=${encodeURIComponent(clientReference)}`);
      if (data.status === "confirmed") {
        stopPolling();
        statusBox.classList.add("hidden");
        const summary = data.selections.map((s) => `${s.quantity} vote(s) for "${s.nominee.name}"`).join(", ");
        showAlert(`Payment confirmed! ${summary} recorded.`, "success");
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

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  alertEl.innerHTML = "";

  if (selectedByCategory.size === 0) {
    showAlert("Please select at least one nominee first.", "error");
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
    const selections = [...selectedByCategory.values()].map((s) => ({ nomineeId: s.nomineeId, quantity }));
    const { clientReference, amountGhs } = await apiPost("/votes", {
      selections,
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
      metadata: { selections, voterName },
      callback: function () {
        statusBox.classList.remove("hidden");
        statusText.textContent = `Confirming your payment... (GHS ${amountGhs})`;
        submitBtn.textContent = "Confirming payment...";
        pollPaymentStatus(clientReference);
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
