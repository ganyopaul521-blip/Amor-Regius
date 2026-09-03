let selectedType = null;
let selectedPrice = 0;
let quantity = 1;
let pollTimer = null;

const optionEls = document.querySelectorAll(".ticket-option");
const qtyValueEl = document.getElementById("qty-value");
const summaryTypeEl = document.getElementById("summary-type");
const summaryTotalEl = document.getElementById("summary-total");
const alertEl = document.getElementById("ticket-alert");
const form = document.getElementById("ticket-form");
const submitBtn = document.getElementById("submit-btn");
const statusBox = document.getElementById("payment-status");
const statusText = document.getElementById("payment-status-text");
const ticketPreviewCard = document.getElementById("ticket-preview-card");
const ticketImage = document.getElementById("ticket-image");
const ticketDownload = document.getElementById("ticket-download");
const detailsCard = document.getElementById("details-card");
const stepEls = document.querySelectorAll("#payment-steps .step");

// ---- live pricing (never hardcode - always reflect the backend's actual prices) ----
async function loadPricing() {
  try {
    const { prices } = await apiGet("/tickets/pricing");
    optionEls.forEach((el) => {
      const type = el.dataset.type;
      if (prices[type] != null) {
        el.dataset.price = prices[type];
        const valueEl = el.querySelector(".price-value");
        if (valueEl) valueEl.textContent = prices[type];
      }
    });
    if (selectedType) {
      selectedPrice = Number(document.querySelector(`.ticket-option[data-type="${selectedType}"]`).dataset.price);
      updateSummary();
    }
  } catch (err) {
    // fall back to the prices already rendered server-side in the HTML
  }
}
loadPricing();

function setStep(n) {
  stepEls.forEach((el) => {
    const step = Number(el.dataset.step);
    el.classList.toggle("done", step < n);
    el.classList.toggle("active", step === n);
  });
}

function updateSummary() {
  summaryTypeEl.textContent = selectedType
    ? `${selectedType[0].toUpperCase()}${selectedType.slice(1)} x${quantity}`
    : "-";
  summaryTotalEl.textContent = `GHS ${selectedPrice * quantity}`;
}

optionEls.forEach((el) => {
  el.addEventListener("click", () => {
    optionEls.forEach((o) => o.classList.remove("selected"));
    el.classList.add("selected");
    selectedType = el.dataset.type;
    selectedPrice = Number(el.dataset.price);
    updateSummary();
    setStep(2);
  });
});

document.getElementById("qty-minus").addEventListener("click", () => {
  quantity = Math.max(1, quantity - 1);
  qtyValueEl.textContent = quantity;
  updateSummary();
});

document.getElementById("qty-plus").addEventListener("click", () => {
  quantity = Math.min(20, quantity + 1);
  qtyValueEl.textContent = quantity;
  updateSummary();
});

function showAlert(message, type) {
  alertEl.innerHTML = `<div class="alert ${type}">${message}</div>`;
}

function resetForm() {
  form.reset();
  optionEls.forEach((o) => o.classList.remove("selected"));
  selectedType = null;
  selectedPrice = 0;
  quantity = 1;
  qtyValueEl.textContent = "1";
  updateSummary();
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function ticketTypeLabel(type) {
  return type ? `${type[0].toUpperCase()}${type.slice(1)}` : "-";
}

function showReceipt(order, statusData) {
  document.getElementById("receipt-ticket-type").textContent = `${ticketTypeLabel(statusData.ticketType)} x${statusData.quantity}`;
  document.getElementById("receipt-amount").textContent = `GHS ${statusData.amountGhs}`;
  document.getElementById("receipt-transaction").textContent = statusData.transactionId || order.client_reference;
  document.getElementById("receipt-confirmation").textContent = statusData.ticketEmailed
    ? "Sent to your email"
    : "Available to download below";

  const url = `${API_BASE}/tickets/${order.id}/ticket.png?ref=${encodeURIComponent(order.client_reference)}`;
  ticketImage.src = url;
  ticketDownload.href = url;
  ticketDownload.setAttribute("download", `amor-regius-ticket-${order.id}.png`);

  detailsCard.classList.add("hidden");
  ticketPreviewCard.classList.remove("hidden");
  ticketPreviewCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

function pollOrderStatus(order) {
  const startedAt = Date.now();
  const TIMEOUT_MS = 90_000;

  pollTimer = setInterval(async () => {
    if (Date.now() - startedAt > TIMEOUT_MS) {
      stopPolling();
      statusText.textContent =
        "Still waiting for confirmation. If you approved the prompt, your order will update shortly - you can check back later.";
      submitBtn.disabled = false;
      submitBtn.textContent = "Pay with MTN Mobile Money";
      return;
    }

    try {
      const data = await apiGet(`/tickets/${order.id}/status?ref=${encodeURIComponent(order.client_reference)}`);
      if (data.status === "confirmed") {
        stopPolling();
        statusBox.classList.add("hidden");
        setStep(5);
        showReceipt(order, data);
        submitBtn.disabled = false;
        submitBtn.textContent = "Pay with MTN Mobile Money";
      } else if (data.status === "rejected") {
        stopPolling();
        statusBox.classList.add("hidden");
        setStep(3);
        showAlert("Payment was not completed. Please try again.", "error");
        submitBtn.disabled = false;
        submitBtn.textContent = "Pay with MTN Mobile Money";
      }
      // status still 'pending' -> keep polling, stay on step 4 (approve on phone)
    } catch (err) {
      // transient network hiccup - keep polling until timeout
    }
  }, 3000);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  alertEl.innerHTML = "";

  if (!selectedType) {
    showAlert("Please select a ticket type.", "error");
    return;
  }

  const buyerName = document.getElementById("buyerName").value.trim();
  const buyerPhone = document.getElementById("buyerPhone").value.trim();
  const buyerEmail = document.getElementById("buyerEmail").value.trim();

  submitBtn.disabled = true;
  submitBtn.textContent = "Sending payment request...";
  setStep(3);
  statusBox.classList.remove("hidden");
  statusText.textContent = "Sending payment request...";

  try {
    const { order, message } = await apiPost("/tickets", {
      buyerName,
      buyerPhone,
      buyerEmail,
      ticketType: selectedType,
      quantity,
    });

    setStep(4);
    statusText.textContent = `${message} (Order #${order.id}, GHS ${order.amount_ghs})`;
    submitBtn.textContent = "Waiting for approval...";
    pollOrderStatus(order);
  } catch (err) {
    statusBox.classList.add("hidden");
    setStep(2);
    showAlert(err.message || "Something went wrong. Please try again.", "error");
    submitBtn.disabled = false;
    submitBtn.textContent = "Pay with MTN Mobile Money";
  }
});

updateSummary();
