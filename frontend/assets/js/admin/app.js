// Amor Regius Admin Control Center - application shell, routing, and all
// view logic. Vanilla JS (no framework/build step), matching the rest of
// the project. Talks only to endpoints that already exist in
// backend/routes/admin.js (plus the small additions: /login, /stats,
// /activity - see that file for what each returns).

const ADMIN_ORIGIN = API_BASE.replace(/\/api$/, "");
const ADMIN_KEY_STORAGE = "amorRegiusAdminKey";

const state = {
  view: "dashboard",
  stats: null,
  orders: [],
  votePayments: [],
  nomineeCategories: [],
  galleryPhotos: [],
  activity: [],
  lastUpdated: null,
  loadError: null,
  loading: true,
  revenueGranularity: "daily",
  ordersTable: { search: "", status: "", ticketType: "", sortKey: "created_at", sortDir: "desc", page: 1 },
  paymentsTable: { search: "", status: "", source: "", page: 1 },
  attendeesTable: { search: "", page: 1 },
  PAGE_SIZE: 8,
};

// ---------------------------------------------------------------------------
// AUTH
// ---------------------------------------------------------------------------
function getAdminKey() {
  return sessionStorage.getItem(ADMIN_KEY_STORAGE) || "";
}

function setAdminKey(key) {
  sessionStorage.setItem(ADMIN_KEY_STORAGE, key);
}

function clearAdminKey() {
  sessionStorage.removeItem(ADMIN_KEY_STORAGE);
}

async function adminFetch(path, options = {}) {
  const res = await fetch(`${ADMIN_ORIGIN}/api/admin${path}`, {
    ...options,
    headers: { ...(options.headers || {}), "x-admin-key": getAdminKey() },
  });
  if (res.status === 401) {
    clearAdminKey();
    showLogin("Your session expired. Please sign in again.");
    throw new Error("Unauthorized");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function adminFetchForm(path, formData) {
  const res = await fetch(`${ADMIN_ORIGIN}/api/admin${path}`, {
    method: "POST",
    headers: { "x-admin-key": getAdminKey() },
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function showLogin(message) {
  document.getElementById("admin-shell").classList.add("hidden");
  document.getElementById("admin-login-screen").classList.remove("hidden");
  const errEl = document.getElementById("login-error");
  if (message) {
    errEl.textContent = message;
    errEl.classList.remove("hidden");
  } else {
    errEl.classList.add("hidden");
  }
}

function showShell() {
  document.getElementById("admin-login-screen").classList.add("hidden");
  document.getElementById("admin-shell").classList.remove("hidden");
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const key = document.getElementById("login-key").value.trim();
  const btn = document.getElementById("login-btn");
  if (!key) return;

  btn.disabled = true;
  btn.textContent = "Signing in...";
  try {
    const res = await fetch(`${ADMIN_ORIGIN}/api/admin/login`, {
      method: "POST",
      headers: { "x-admin-key": key },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Invalid admin key");
    setAdminKey(key);
    document.getElementById("login-key").value = "";
    showShell();
    initAdminName();
    loadAll(true);
  } catch (err) {
    showLogin(err.message || "Invalid admin key");
  } finally {
    btn.disabled = false;
    btn.textContent = "Sign In";
  }
});

document.getElementById("logout-btn").addEventListener("click", () => {
  clearAdminKey();
  showLogin();
});

function initAdminName() {
  document.getElementById("admin-avatar").textContent = "A";
}

// ---------------------------------------------------------------------------
// ROUTING / SIDEBAR
// ---------------------------------------------------------------------------
const VIEW_META = {
  dashboard: { title: "Dashboard", subtitle: "Overview of Amor Regius performance" },
  orders: { title: "Ticket Orders", subtitle: "Every ticket purchase, in one place" },
  payments: { title: "Payments", subtitle: "Paystack transaction monitoring" },
  attendees: { title: "Attendees", subtitle: "Who's confirmed for the night" },
  voting: { title: "Voting", subtitle: "Award category standings and vote payments" },
  gallery: { title: "Gallery", subtitle: "Manage the public photo gallery" },
  reports: { title: "Reports", subtitle: "Export event and financial data" },
  settings: { title: "Settings", subtitle: "System configuration status" },
};

function setView(view) {
  if (!VIEW_META[view]) view = "dashboard";
  state.view = view;
  document.querySelectorAll(".admin-view").forEach((el) => el.classList.toggle("active", el.id === `view-${view}`));
  document.querySelectorAll(".admin-nav a[data-view]").forEach((a) => a.classList.toggle("active", a.dataset.view === view));
  document.getElementById("page-title").textContent = VIEW_META[view].title;
  document.getElementById("page-subtitle").textContent = VIEW_META[view].subtitle;
  closeSidebar();
  renderCurrentView();
  window.location.hash = view;
}

document.querySelectorAll(".admin-nav a[data-view]").forEach((a) => {
  a.addEventListener("click", (e) => {
    e.preventDefault();
    setView(a.dataset.view);
  });
});

window.addEventListener("hashchange", () => setView(window.location.hash.replace("#", "")));

function openSidebar() {
  document.getElementById("admin-sidebar").classList.add("open");
  document.getElementById("sidebar-scrim").classList.add("open");
}
function closeSidebar() {
  document.getElementById("admin-sidebar").classList.remove("open");
  document.getElementById("sidebar-scrim").classList.remove("open");
}
document.getElementById("sidebar-toggle").addEventListener("click", openSidebar);
document.getElementById("sidebar-scrim").addEventListener("click", closeSidebar);

// ---------------------------------------------------------------------------
// DATA LOADING
// ---------------------------------------------------------------------------
async function loadAll(isFirstLoad) {
  if (isFirstLoad) state.loading = true;
  state.loadError = null;
  renderLoadingIfNeeded();

  const results = await Promise.allSettled([
    adminFetch("/stats"),
    adminFetch("/tickets"),
    adminFetch("/votes"),
    adminFetch("/activity"),
    apiGet("/gallery"),
    apiGet("/votes/nominees"),
  ]);

  const [statsR, ordersR, votesR, activityR, galleryR, nomineesR] = results;

  if (statsR.status === "fulfilled") state.stats = statsR.value;
  if (ordersR.status === "fulfilled") state.orders = ordersR.value.orders;
  if (votesR.status === "fulfilled") state.votePayments = votesR.value.payments;
  if (activityR.status === "fulfilled") state.activity = activityR.value.activity;
  if (galleryR.status === "fulfilled") state.galleryPhotos = galleryR.value.photos;
  if (nomineesR.status === "fulfilled") state.nomineeCategories = nomineesR.value.categories;

  const anyFailed = results.some((r) => r.status === "rejected");
  const allFailed = results.every((r) => r.status === "rejected");
  if (allFailed) {
    state.loadError = "We couldn't retrieve dashboard data right now.";
  } else if (anyFailed) {
    showToast("Some data couldn't be refreshed. Showing the latest available.", "error");
  }

  state.loading = false;
  state.lastUpdated = new Date();
  updateLastUpdatedLabel();
  renderCurrentView();
}

function updateLastUpdatedLabel() {
  const el = document.getElementById("last-updated");
  if (!state.lastUpdated) {
    el.textContent = "";
    return;
  }
  el.textContent = `Last updated: ${relativeTime(state.lastUpdated)}`;
}
setInterval(updateLastUpdatedLabel, 30000);

document.getElementById("refresh-btn").addEventListener("click", () => loadAll(false));

function relativeTime(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 15) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

// ---------------------------------------------------------------------------
// SHARED HELPERS
// ---------------------------------------------------------------------------
function money(n) {
  return `GHS ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function statusBadge(status) {
  const map = {
    confirmed: ["badge-success", "Success"],
    pending: ["badge-pending", "Pending"],
    rejected: ["badge-failed", "Failed"],
  };
  const [cls, label] = map[status] || ["badge-neutral", status];
  return `<span class="badge ${cls}">${label}</span>`;
}

function ticketTypeLabel(t) {
  return t ? t[0].toUpperCase() + t.slice(1) : "-";
}

function formatDateTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso.replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function paginate(rows, page, pageSize) {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const start = (clampedPage - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), page: clampedPage, totalPages, total: rows.length };
}

function renderPagination(container, { page, totalPages }, onPage) {
  if (totalPages <= 1) {
    container.innerHTML = "";
    return;
  }
  const buttons = [];
  buttons.push(`<button ${page === 1 ? "disabled" : ""} data-page="${page - 1}">&#8249;</button>`);
  for (let i = 1; i <= totalPages; i++) {
    if (totalPages > 7 && Math.abs(i - page) > 2 && i !== 1 && i !== totalPages) {
      if (i === 2 || i === totalPages - 1) buttons.push(`<span>&hellip;</span>`);
      continue;
    }
    buttons.push(`<button class="${i === page ? "active" : ""}" data-page="${i}">${i}</button>`);
  }
  buttons.push(`<button ${page === totalPages ? "disabled" : ""} data-page="${page + 1}">&#8250;</button>`);
  container.innerHTML = buttons.join("");
  container.querySelectorAll("button[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => onPage(Number(btn.dataset.page)));
  });
}

function downloadCsv(filename, headers, rows) {
  const escapeCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [headers.map(escapeCell).join(","), ...rows.map((r) => r.map(escapeCell).join(","))].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// RENDER DISPATCH
// ---------------------------------------------------------------------------
function renderLoadingIfNeeded() {
  if (state.loading) renderCurrentView();
}

function renderCurrentView() {
  if (state.loadError) {
    renderGlobalError();
    return;
  }
  const renderers = {
    dashboard: renderDashboard,
    orders: renderOrders,
    payments: renderPayments,
    attendees: renderAttendees,
    voting: renderVoting,
    gallery: renderGalleryView,
    reports: renderReports,
    settings: renderSettings,
  };
  (renderers[state.view] || renderDashboard)();
}

function renderGlobalError() {
  const container = document.getElementById(`view-${state.view}`);
  if (!container) return;
  container.innerHTML = `
    <div class="state-block state-error">
      <div class="state-icon"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2 1 21h22L12 2zm0 15a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4zm1-4h-2v-5h2v5z"/></svg></div>
      <h3>Unable to load data</h3>
      <p>We couldn't retrieve information from the server right now. Please check your connection and try again.</p>
      <button class="btn btn-primary btn-sm" id="retry-load">Try Again</button>
    </div>`;
  document.getElementById("retry-load").addEventListener("click", () => loadAll(true));
}

// ===========================================================================
// DASHBOARD
// ===========================================================================
function renderDashboard() {
  const el = document.getElementById("view-dashboard");

  if (state.loading) {
    el.innerHTML = `
      <div class="kpi-grid">${Array(6).fill('<div class="skeleton skeleton-kpi"></div>').join("")}</div>
      <div class="admin-panel"><div class="skeleton skeleton-text"></div><div class="skeleton" style="height:220px;border-radius:12px"></div></div>`;
    return;
  }

  const s = state.stats;
  if (!s) {
    el.innerHTML = `<div class="state-block"><h3>Dashboard unavailable</h3><p>Stats could not be loaded.</p></div>`;
    return;
  }

  const kpis = [
    { label: "Total Revenue", value: money(s.revenue.totalGhs), icon: "gold", sub: `${s.tickets.totalOrders} total orders` },
    { label: "Tickets Sold", value: s.tickets.sold, icon: "gold", sub: "Confirmed orders only" },
    { label: "Total Orders", value: s.tickets.totalOrders, icon: "gold" },
    { label: "Successful Payments", value: s.payments.successful, icon: "success", tone: "tone-success" },
    { label: "Pending Payments", value: s.payments.pending, icon: "gold" },
    { label: "Failed Payments", value: s.payments.failed, icon: "danger", tone: "tone-danger" },
  ];

  el.innerHTML = `
    <div class="kpi-grid">
      ${kpis
        .map(
          (k) => `
        <div class="kpi-card ${k.tone || ""}">
          <div class="kpi-icon"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2 4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3z"/></svg></div>
          <div class="kpi-label">${k.label}</div>
          <div class="kpi-value">${k.value}</div>
          ${k.sub ? `<div class="kpi-sub">${k.sub}</div>` : ""}
        </div>`
        )
        .join("")}
    </div>

    <div class="admin-grid-2">
      <div class="admin-panel">
        <div class="admin-panel-head">
          <div>
            <h2>Revenue Over Time</h2>
            <p class="muted">Confirmed ticket revenue, GHS</p>
          </div>
          <div class="chip-tabs" id="revenue-granularity">
            <button data-g="daily" class="${state.revenueGranularity === "daily" ? "active" : ""}">Daily</button>
            <button data-g="weekly" class="${state.revenueGranularity === "weekly" ? "active" : ""}">Weekly</button>
            <button data-g="monthly" class="${state.revenueGranularity === "monthly" ? "active" : ""}">Monthly</button>
          </div>
        </div>
        <div class="chart-wrap" id="revenue-chart"></div>
      </div>

      <div class="admin-panel">
        <div class="admin-panel-head"><h2>Ticket Sales</h2></div>
        ${renderTicketDistribution(s.revenue.byTicketType)}
      </div>
    </div>

    <div class="admin-grid-2">
      <div class="admin-panel">
        <div class="admin-panel-head">
          <h2>Recent Orders</h2>
          <a href="#orders" class="muted">View all &rarr;</a>
        </div>
        ${renderRecentOrdersTable()}
      </div>

      <div class="admin-panel">
        <div class="admin-panel-head"><h2>System Health</h2></div>
        ${renderSystemHealth()}
      </div>
    </div>

    <div class="admin-panel">
      <div class="admin-panel-head"><h2>Recent Activity</h2></div>
      ${renderActivityList()}
    </div>
  `;

  document.querySelectorAll("#revenue-granularity button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.revenueGranularity = btn.dataset.g;
      renderDashboard();
    });
  });

  const points = groupRevenueSeries(s.revenue.series, state.revenueGranularity);
  renderBarChart(document.getElementById("revenue-chart"), points, { formatValue: money });
}

function renderTicketDistribution(byType) {
  const types = ["single", "double", "executive"];
  const totalSold = types.reduce((sum, t) => sum + (byType[t]?.sold || 0), 0) || 1;
  return types
    .map((t) => {
      const d = byType[t] || { sold: 0, revenueGhs: 0 };
      const pct = Math.round((d.sold / totalSold) * 100);
      return `
        <div class="dist-row">
          <div class="dist-row-head">
            <span>${ticketTypeLabel(t)}</span>
            <strong>${d.sold} sold &middot; ${money(d.revenueGhs)}</strong>
          </div>
          <div class="dist-bar-track"><div class="dist-bar-fill" style="width:${pct}%"></div></div>
        </div>`;
    })
    .join("");
}

function renderRecentOrdersTable() {
  const recent = [...state.orders].slice(0, 5);
  if (recent.length === 0) {
    return `<p class="muted">No ticket orders yet.</p>`;
  }
  return `
    <div class="table-scroll">
      <table class="admin-table">
        <thead><tr><th class="no-sort">Customer</th><th class="no-sort">Ticket</th><th class="no-sort">Amount</th><th class="no-sort">Status</th></tr></thead>
        <tbody>
          ${recent
            .map(
              (o) => `
            <tr data-order-id="${o.id}">
              <td data-label="Customer"><div class="cell-customer"><strong>${escapeHtml(o.buyer_name)}</strong><span>${escapeHtml(o.buyer_email || o.buyer_phone)}</span></div></td>
              <td data-label="Ticket">${ticketTypeLabel(o.ticket_type)} &times;${o.quantity}</td>
              <td data-label="Amount">${money(o.amount_ghs)}</td>
              <td data-label="Status">${statusBadge(o.status)}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
}

function renderSystemHealth() {
  const s = state.stats;
  const paystack = s?.services?.paystackConfigured;
  const email = s?.services?.emailConfigured;
  return `
    <div class="health-list">
      <div class="health-row"><span>API</span><span class="health-status health-ok">Operational</span></div>
      <div class="health-row"><span>Database</span><span class="health-status health-ok">Connected</span></div>
      <div class="health-row"><span>Paystack</span><span class="health-status ${paystack ? "health-ok" : "health-off"}">${paystack ? "Configured" : "Not configured"}</span></div>
      <div class="health-row"><span>Email Delivery</span><span class="health-status ${email ? "health-ok" : "health-off"}">${email ? "Configured" : "Not configured"}</span></div>
    </div>`;
}

function renderActivityList() {
  if (!state.activity.length) {
    return `<p class="muted">No administrative activity recorded yet.</p>`;
  }
  return `
    <div class="activity-list">
      ${state.activity
        .map(
          (a) => `
        <div class="activity-row">
          <span class="activity-dot"></span>
          <div class="activity-text"><strong>${escapeHtml(a.action)}</strong>${a.detail ? `<span>${escapeHtml(a.detail)}</span>` : ""}</div>
          <span class="activity-time">${formatDateTime(a.created_at)}</span>
        </div>`
        )
        .join("")}
    </div>`;
}

// ===========================================================================
// TICKET ORDERS
// ===========================================================================
function getFilteredOrders() {
  const t = state.ordersTable;
  let rows = [...state.orders];

  if (t.search) {
    const q = t.search.toLowerCase();
    rows = rows.filter(
      (o) =>
        o.buyer_name?.toLowerCase().includes(q) ||
        o.buyer_email?.toLowerCase().includes(q) ||
        o.buyer_phone?.includes(q) ||
        String(o.id).includes(q) ||
        o.client_reference?.toLowerCase().includes(q) ||
        o.financial_transaction_id?.toLowerCase().includes(q)
    );
  }
  if (t.status) rows = rows.filter((o) => o.status === t.status);
  if (t.ticketType) rows = rows.filter((o) => o.ticket_type === t.ticketType);

  rows.sort((a, b) => {
    const dir = t.sortDir === "asc" ? 1 : -1;
    const av = a[t.sortKey],
      bv = b[t.sortKey];
    if (av == null) return 1;
    if (bv == null) return -1;
    return av > bv ? dir : av < bv ? -dir : 0;
  });

  return rows;
}

function renderOrders() {
  const el = document.getElementById("view-orders");

  if (state.loading) {
    el.innerHTML = `<div class="admin-panel">${Array(5).fill('<div class="skeleton skeleton-row"></div>').join("")}</div>`;
    return;
  }

  if (state.orders.length === 0) {
    el.innerHTML = `
      <div class="admin-panel">
        <div class="state-block">
          <div class="state-icon"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M20 6h-4V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2zM10 4h4v2h-4V4z"/></svg></div>
          <h3>No Ticket Orders Yet</h3>
          <p>Ticket purchases will appear here once customers complete their orders.</p>
        </div>
      </div>`;
    return;
  }

  const t = state.ordersTable;
  const filtered = getFilteredOrders();
  const { rows, page, totalPages, total } = paginate(filtered, t.page, state.PAGE_SIZE);
  t.page = page;

  const sortArrow = (key) => (t.sortKey === key ? (t.sortDir === "asc" ? "&#9650;" : "&#9660;") : "");

  el.innerHTML = `
    <div class="admin-panel">
      <div class="table-toolbar">
        <input type="search" id="orders-search" placeholder="Search name, email, phone, order #, transaction..." value="${escapeHtml(t.search)}" />
        <select id="orders-filter-status">
          <option value="">All statuses</option>
          <option value="confirmed" ${t.status === "confirmed" ? "selected" : ""}>Success</option>
          <option value="pending" ${t.status === "pending" ? "selected" : ""}>Pending</option>
          <option value="rejected" ${t.status === "rejected" ? "selected" : ""}>Failed</option>
        </select>
        <select id="orders-filter-type">
          <option value="">All ticket types</option>
          <option value="single" ${t.ticketType === "single" ? "selected" : ""}>Single</option>
          <option value="double" ${t.ticketType === "double" ? "selected" : ""}>Double</option>
          <option value="executive" ${t.ticketType === "executive" ? "selected" : ""}>Executive</option>
        </select>
      </div>

      <div class="table-scroll">
        <table class="admin-table">
          <thead>
            <tr>
              <th data-sort="id" class="${t.sortKey === "id" ? "sorted" : ""}">Order <span class="sort-arrow">${sortArrow("id")}</span></th>
              <th class="no-sort">Customer</th>
              <th data-sort="ticket_type" class="${t.sortKey === "ticket_type" ? "sorted" : ""}">Ticket <span class="sort-arrow">${sortArrow("ticket_type")}</span></th>
              <th data-sort="amount_ghs" class="${t.sortKey === "amount_ghs" ? "sorted" : ""}">Amount <span class="sort-arrow">${sortArrow("amount_ghs")}</span></th>
              <th class="no-sort">Payment Ref</th>
              <th data-sort="status" class="${t.sortKey === "status" ? "sorted" : ""}">Status <span class="sort-arrow">${sortArrow("status")}</span></th>
              <th data-sort="created_at" class="${t.sortKey === "created_at" ? "sorted" : ""}">Date <span class="sort-arrow">${sortArrow("created_at")}</span></th>
              <th class="no-sort">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (o) => `
              <tr data-order-id="${o.id}">
                <td data-label="Order">#${o.id}</td>
                <td data-label="Customer"><div class="cell-customer"><strong>${escapeHtml(o.buyer_name)}</strong><span>${escapeHtml(o.buyer_email || o.buyer_phone)}</span></div></td>
                <td data-label="Ticket">${ticketTypeLabel(o.ticket_type)} &times;${o.quantity}</td>
                <td data-label="Amount">${money(o.amount_ghs)}</td>
                <td data-label="Payment Ref"><span class="cell-mono">${o.financial_transaction_id || "-"}</span></td>
                <td data-label="Status">${statusBadge(o.status)}</td>
                <td data-label="Date">${formatDateTime(o.created_at)}</td>
                <td data-label="Actions">
                  <div class="row-actions">
                    <button class="icon-btn view-order-btn" data-id="${o.id}" title="View details"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 4.5C7 4.5 2.7 7.6 1 12c1.7 4.4 6 7.5 11 7.5s9.3-3.1 11-7.5c-1.7-4.4-6-7.5-11-7.5zm0 12.5a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg></button>
                  </div>
                </td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>

      <div class="pagination">
        <span>Showing ${rows.length} of ${total} orders</span>
        <div class="pagination-controls" id="orders-pagination"></div>
      </div>
    </div>`;

  document.getElementById("orders-search").addEventListener("input", (e) => {
    t.search = e.target.value;
    t.page = 1;
    renderOrders();
  });
  document.getElementById("orders-filter-status").addEventListener("change", (e) => {
    t.status = e.target.value;
    t.page = 1;
    renderOrders();
  });
  document.getElementById("orders-filter-type").addEventListener("change", (e) => {
    t.ticketType = e.target.value;
    t.page = 1;
    renderOrders();
  });
  el.querySelectorAll("th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (t.sortKey === key) t.sortDir = t.sortDir === "asc" ? "desc" : "asc";
      else {
        t.sortKey = key;
        t.sortDir = "desc";
      }
      renderOrders();
    });
  });
  el.querySelectorAll(".view-order-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openOrderDrawer(Number(btn.dataset.id));
    });
  });
  el.querySelectorAll("tbody tr[data-order-id]").forEach((tr) => {
    tr.addEventListener("click", () => openOrderDrawer(Number(tr.dataset.orderId)));
  });
  renderPagination(document.getElementById("orders-pagination"), { page, totalPages }, (p) => {
    t.page = p;
    renderOrders();
  });
}

// ---- Order detail drawer ----
function openOrderDrawer(orderId) {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return;

  const scrim = document.createElement("div");
  scrim.className = "modal-scrim";
  scrim.innerHTML = `
    <div class="modal-drawer" role="dialog" aria-modal="true" aria-label="Order details">
      <div class="modal-head">
        <div>
          <h3>Order #${order.id}</h3>
          <p class="muted">${formatDateTime(order.created_at)}</p>
        </div>
        <button class="modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="detail-group">
          <div class="detail-group-label">Customer</div>
          <div class="detail-row"><span>Name</span><span>${escapeHtml(order.buyer_name)}</span></div>
          <div class="detail-row"><span>Email</span><span>${escapeHtml(order.buyer_email || "-")}</span></div>
          <div class="detail-row"><span>Phone</span><span>${escapeHtml(order.buyer_phone)}</span></div>
        </div>
        <div class="detail-group">
          <div class="detail-group-label">Order</div>
          <div class="detail-row"><span>Ticket</span><span>${ticketTypeLabel(order.ticket_type)}</span></div>
          <div class="detail-row"><span>Quantity</span><span>${order.quantity}</span></div>
          <div class="detail-row"><span>Amount</span><span>${money(order.amount_ghs)}</span></div>
        </div>
        <div class="detail-group">
          <div class="detail-group-label">Payment</div>
          <div class="detail-row"><span>Provider</span><span>Paystack</span></div>
          <div class="detail-row"><span>Status</span><span>${statusBadge(order.status)}</span></div>
          <div class="detail-row"><span>Payment Ref ID</span><span>${order.financial_transaction_id || "Not yet available"}</span></div>
          <div class="detail-row"><span>Reference</span><span class="cell-mono">${order.client_reference}</span></div>
        </div>
        <div class="detail-group">
          <div class="detail-group-label">Ticket Delivery</div>
          <div class="detail-row"><span>Status</span><span>${order.ticket_sent_at ? `&#10003; Sent (${formatDateTime(order.ticket_sent_at)})` : "&#9888; Not Sent"}</span></div>
        </div>

        <div class="modal-actions">
          <select id="drawer-status-select" class="btn-block" style="padding:12px;border-radius:10px;border:1.5px solid var(--border)">
            <option value="pending" ${order.status === "pending" ? "selected" : ""}>Pending</option>
            <option value="confirmed" ${order.status === "confirmed" ? "selected" : ""}>Confirmed</option>
            <option value="rejected" ${order.status === "rejected" ? "selected" : ""}>Rejected</option>
          </select>
          <button class="btn btn-outline-dark btn-block" id="drawer-update-status">Update Status</button>
          <button class="btn btn-primary btn-block" id="drawer-resend" ${order.status !== "confirmed" ? "disabled" : ""}>Resend Ticket</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(scrim);
  document.body.style.overflow = "hidden";

  function close() {
    scrim.remove();
    document.body.style.overflow = "";
  }
  scrim.addEventListener("click", (e) => {
    if (e.target === scrim) close();
  });
  scrim.querySelector(".modal-close").addEventListener("click", close);
  document.addEventListener("keydown", function escHandler(e) {
    if (e.key === "Escape") {
      close();
      document.removeEventListener("keydown", escHandler);
    }
  });

  scrim.querySelector("#drawer-update-status").addEventListener("click", async (e) => {
    const newStatus = scrim.querySelector("#drawer-status-select").value;
    e.target.disabled = true;
    e.target.textContent = "Updating...";
    try {
      const { order: updated } = await adminFetch(`/tickets/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const idx = state.orders.findIndex((o) => o.id === order.id);
      state.orders[idx] = updated;
      showToast(`Order #${order.id} updated to ${newStatus}.`, "success");
      close();
      renderOrders();
      loadAll(false);
    } catch (err) {
      showToast(err.message || "Could not update order.", "error");
      e.target.disabled = false;
      e.target.textContent = "Update Status";
    }
  });

  scrim.querySelector("#drawer-resend").addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "Sending...";
    try {
      await adminFetch(`/tickets/${order.id}/resend-ticket`, { method: "POST" });
      const idx = state.orders.findIndex((o) => o.id === order.id);
      state.orders[idx] = { ...state.orders[idx], ticket_sent_at: new Date().toISOString() };
      showToast("Ticket resent successfully.", "success");
      close();
      renderOrders();
      loadAll(false);
    } catch (err) {
      showToast(err.message || "Could not resend ticket.", "error");
      e.target.disabled = false;
      e.target.textContent = "Resend Ticket";
    }
  });
}

// ===========================================================================
// PAYMENTS (ticket orders + vote payments, unified as "payment attempts")
// ===========================================================================
function getUnifiedPayments() {
  const ticketPayments = state.orders.map((o) => ({
    id: `T-${o.id}`,
    rawId: o.id,
    source: "Ticket",
    customer: o.buyer_name,
    email: o.buyer_email || o.buyer_phone,
    item: `${ticketTypeLabel(o.ticket_type)} Ticket`,
    amount: o.amount_ghs,
    txn: o.financial_transaction_id,
    reference: o.client_reference,
    status: o.status,
    date: o.created_at,
  }));
  const votePayments = state.votePayments.map((p) => ({
    id: `V-${p.id}`,
    rawId: p.id,
    source: "Vote",
    customer: p.voter_name || p.voter_phone || "Anonymous",
    email: p.voter_phone || "-",
    item: `${p.quantity} vote(s) - ${p.nominee_name}`,
    amount: p.amount_ghs,
    txn: p.financial_transaction_id,
    reference: p.client_reference,
    status: p.status,
    date: p.created_at,
  }));
  return [...ticketPayments, ...votePayments].sort((a, b) => new Date(b.date) - new Date(a.date));
}

function renderPayments() {
  const el = document.getElementById("view-payments");

  if (state.loading) {
    el.innerHTML = `<div class="kpi-grid">${Array(5).fill('<div class="skeleton skeleton-kpi"></div>').join("")}</div>`;
    return;
  }

  const s = state.stats;
  const all = getUnifiedPayments();

  if (all.length === 0) {
    el.innerHTML = `
      <div class="admin-panel"><div class="state-block">
        <div class="state-icon"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg></div>
        <h3>No Payments Found</h3>
        <p>Paystack transactions will appear here once customers start paying.</p>
      </div></div>`;
    return;
  }

  const t = state.paymentsTable;
  let rows = all;
  if (t.search) {
    const q = t.search.toLowerCase();
    rows = rows.filter((r) => r.customer?.toLowerCase().includes(q) || r.email?.toLowerCase().includes(q) || r.txn?.toLowerCase().includes(q) || r.reference?.toLowerCase().includes(q));
  }
  if (t.status) rows = rows.filter((r) => r.status === t.status);
  if (t.source) rows = rows.filter((r) => r.source === t.source);

  const { rows: pageRows, page, totalPages, total } = paginate(rows, t.page, state.PAGE_SIZE);
  t.page = page;

  const paystackConfigured = s?.services?.paystackConfigured;

  el.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Paystack API Status</div>
        <div class="kpi-value" style="font-size:1.1rem">
          <span class="health-status ${paystackConfigured ? "health-ok" : "health-off"}">${paystackConfigured ? "Connected" : "Status unavailable"}</span>
        </div>
      </div>
      <div class="kpi-card"><div class="kpi-label">Payment Requests</div><div class="kpi-value">${s.payments.totalRequests}</div></div>
      <div class="kpi-card tone-success"><div class="kpi-label">Successful</div><div class="kpi-value">${s.payments.successful}</div></div>
      <div class="kpi-card"><div class="kpi-label">Pending</div><div class="kpi-value">${s.payments.pending}</div></div>
      <div class="kpi-card tone-danger"><div class="kpi-label">Failed</div><div class="kpi-value">${s.payments.failed}</div></div>
      <div class="kpi-card"><div class="kpi-label">Success Rate</div><div class="kpi-value">${s.payments.successRate != null ? s.payments.successRate + "%" : "-"}</div></div>
    </div>

    <div class="admin-panel">
      <div class="admin-panel-head"><h2>All Payment Transactions</h2></div>
      <div class="table-toolbar">
        <input type="search" id="payments-search" placeholder="Search customer, email, transaction..." value="${escapeHtml(t.search)}" />
        <select id="payments-filter-status">
          <option value="">All statuses</option>
          <option value="confirmed" ${t.status === "confirmed" ? "selected" : ""}>Success</option>
          <option value="pending" ${t.status === "pending" ? "selected" : ""}>Pending</option>
          <option value="rejected" ${t.status === "rejected" ? "selected" : ""}>Failed</option>
        </select>
        <select id="payments-filter-source">
          <option value="">Tickets &amp; Votes</option>
          <option value="Ticket" ${t.source === "Ticket" ? "selected" : ""}>Tickets only</option>
          <option value="Vote" ${t.source === "Vote" ? "selected" : ""}>Votes only</option>
        </select>
      </div>
      <div class="table-scroll">
        <table class="admin-table">
          <thead><tr><th class="no-sort">Reference</th><th class="no-sort">Customer</th><th class="no-sort">Item</th><th class="no-sort">Amount</th><th class="no-sort">Provider</th><th class="no-sort">Payment Ref</th><th class="no-sort">Status</th><th class="no-sort">Date</th></tr></thead>
          <tbody>
            ${pageRows
              .map(
                (r) => `
              <tr>
                <td data-label="Reference">${r.id}</td>
                <td data-label="Customer"><div class="cell-customer"><strong>${escapeHtml(r.customer)}</strong><span>${escapeHtml(r.email)}</span></div></td>
                <td data-label="Item">${escapeHtml(r.item)}</td>
                <td data-label="Amount">${money(r.amount)}</td>
                <td data-label="Provider">Paystack</td>
                <td data-label="Payment Ref"><span class="cell-mono">${r.txn || "-"}</span></td>
                <td data-label="Status">${statusBadge(r.status)}</td>
                <td data-label="Date">${formatDateTime(r.date)}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <span>Showing ${pageRows.length} of ${total} transactions</span>
        <div class="pagination-controls" id="payments-pagination"></div>
      </div>
    </div>`;

  document.getElementById("payments-search").addEventListener("input", (e) => {
    t.search = e.target.value;
    t.page = 1;
    renderPayments();
  });
  document.getElementById("payments-filter-status").addEventListener("change", (e) => {
    t.status = e.target.value;
    t.page = 1;
    renderPayments();
  });
  document.getElementById("payments-filter-source").addEventListener("change", (e) => {
    t.source = e.target.value;
    t.page = 1;
    renderPayments();
  });
  renderPagination(document.getElementById("payments-pagination"), { page, totalPages }, (p) => {
    t.page = p;
    renderPayments();
  });
}

// ===========================================================================
// ATTENDEES (derived from confirmed/pending ticket orders - there's no
// separate attendees table, so this is a real, honest view over the same
// order data rather than an invented dataset)
// ===========================================================================
function renderAttendees() {
  const el = document.getElementById("view-attendees");

  if (state.loading) {
    el.innerHTML = `<div class="admin-panel">${Array(5).fill('<div class="skeleton skeleton-row"></div>').join("")}</div>`;
    return;
  }

  const confirmed = state.orders.filter((o) => o.status === "confirmed");
  const pending = state.orders.filter((o) => o.status === "pending");
  const totalGuests = confirmed.reduce((sum, o) => sum + o.quantity, 0);

  if (state.orders.length === 0) {
    el.innerHTML = `<div class="admin-panel"><div class="state-block"><h3>No Attendees Yet</h3><p>Confirmed ticket buyers will appear here.</p></div></div>`;
    return;
  }

  const t = state.attendeesTable;
  let rows = confirmed;
  if (t.search) {
    const q = t.search.toLowerCase();
    rows = rows.filter((o) => o.buyer_name?.toLowerCase().includes(q) || o.buyer_email?.toLowerCase().includes(q));
  }
  const { rows: pageRows, page, totalPages, total } = paginate(rows, t.page, state.PAGE_SIZE);
  t.page = page;

  el.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Confirmed Attendees</div><div class="kpi-value">${totalGuests}</div><div class="kpi-sub">${confirmed.length} orders</div></div>
      <div class="kpi-card"><div class="kpi-label">Pending Orders</div><div class="kpi-value">${pending.length}</div></div>
      <div class="kpi-card"><div class="kpi-label">Total Orders</div><div class="kpi-value">${state.orders.length}</div></div>
    </div>
    <div class="admin-panel">
      <div class="admin-panel-head"><h2>Confirmed Attendees</h2></div>
      <div class="table-toolbar">
        <input type="search" id="attendees-search" placeholder="Search name or email..." value="${escapeHtml(t.search)}" />
      </div>
      <div class="table-scroll">
        <table class="admin-table">
          <thead><tr><th class="no-sort">Name</th><th class="no-sort">Email</th><th class="no-sort">Ticket Type</th><th class="no-sort">Quantity</th><th class="no-sort">Payment</th><th class="no-sort">Ticket Delivery</th><th class="no-sort">Registered</th></tr></thead>
          <tbody>
            ${pageRows
              .map(
                (o) => `
              <tr>
                <td data-label="Name">${escapeHtml(o.buyer_name)}</td>
                <td data-label="Email">${escapeHtml(o.buyer_email || "-")}</td>
                <td data-label="Ticket Type">${ticketTypeLabel(o.ticket_type)}</td>
                <td data-label="Quantity">${o.quantity}</td>
                <td data-label="Payment">${statusBadge(o.status)}</td>
                <td data-label="Ticket Delivery">${o.ticket_sent_at ? "&#10003; Sent" : "&#9888; Not Sent"}</td>
                <td data-label="Registered">${formatDateTime(o.created_at)}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <span>Showing ${pageRows.length} of ${total} attendees</span>
        <div class="pagination-controls" id="attendees-pagination"></div>
      </div>
    </div>`;

  document.getElementById("attendees-search").addEventListener("input", (e) => {
    t.search = e.target.value;
    t.page = 1;
    renderAttendees();
  });
  renderPagination(document.getElementById("attendees-pagination"), { page, totalPages }, (p) => {
    t.page = p;
    renderAttendees();
  });
}

// ===========================================================================
// VOTING MANAGEMENT
// ===========================================================================
function renderVoting() {
  const el = document.getElementById("view-voting");

  if (state.loading) {
    el.innerHTML = `<div class="kpi-grid">${Array(4).fill('<div class="skeleton skeleton-kpi"></div>').join("")}</div>`;
    return;
  }

  const s = state.stats?.voting;
  const categories = state.nomineeCategories;

  el.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Total Votes</div><div class="kpi-value">${s?.totalVotes ?? "-"}</div></div>
      <div class="kpi-card"><div class="kpi-label">Categories</div><div class="kpi-value">${s?.totalCategories ?? "-"}</div></div>
      <div class="kpi-card"><div class="kpi-label">Nominees</div><div class="kpi-value">${s?.totalNominees ?? "-"}</div></div>
      <div class="kpi-card"><div class="kpi-label">Vote Payments</div><div class="kpi-value">${state.votePayments.length}</div></div>
    </div>

    <div class="admin-panel">
      <div class="admin-panel-head"><h2>Category Standings</h2></div>
      ${categories
        .map((cat) => {
          const total = cat.nominees.reduce((sum, n) => sum + n.votes, 0) || 1;
          return `
          <div style="margin-bottom:20px">
            <h3 style="font-family:var(--font-display);font-size:0.95rem;color:var(--navy);margin:0 0 10px">${escapeHtml(cat.name)}</h3>
            ${cat.nominees
              .map(
                (n) => `
              <div class="dist-row">
                <div class="dist-row-head"><span>${escapeHtml(n.name)}</span><strong>${n.votes} votes (${Math.round((n.votes / total) * 100)}%)</strong></div>
                <div class="dist-bar-track"><div class="dist-bar-fill" style="width:${Math.round((n.votes / total) * 100)}%"></div></div>
              </div>`
              )
              .join("")}
          </div>`;
        })
        .join("")}
    </div>

    <div class="admin-panel">
      <div class="admin-panel-head"><h2>Vote Payments</h2></div>
      ${
        state.votePayments.length === 0
          ? `<p class="muted">No vote payments yet.</p>`
          : `<div class="table-scroll">
        <table class="admin-table">
          <thead><tr><th class="no-sort">Voter</th><th class="no-sort">Nominee</th><th class="no-sort">Votes</th><th class="no-sort">Amount</th><th class="no-sort">Payment Ref</th><th class="no-sort">Status</th><th class="no-sort">Date</th><th class="no-sort">Action</th></tr></thead>
          <tbody>
            ${state.votePayments
              .map(
                (p) => `
              <tr>
                <td data-label="Voter">${escapeHtml(p.voter_name || p.voter_phone || "Anonymous")}</td>
                <td data-label="Nominee">${escapeHtml(p.nominee_name)} <span class="muted">(${escapeHtml(p.category_name)})</span></td>
                <td data-label="Votes">${p.quantity}</td>
                <td data-label="Amount">${money(p.amount_ghs)}</td>
                <td data-label="Payment Ref"><span class="cell-mono">${p.financial_transaction_id || "-"}</span></td>
                <td data-label="Status">${statusBadge(p.status)}</td>
                <td data-label="Date">${formatDateTime(p.created_at)}</td>
                <td data-label="Action">
                  <select class="vote-status-select" data-id="${p.id}" style="padding:6px 8px;border-radius:8px;border:1px solid var(--border);font-size:0.78rem">
                    <option value="pending" ${p.status === "pending" ? "selected" : ""}>Pending</option>
                    <option value="confirmed" ${p.status === "confirmed" ? "selected" : ""}>Confirmed</option>
                    <option value="rejected" ${p.status === "rejected" ? "selected" : ""}>Rejected</option>
                  </select>
                </td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>`
      }
    </div>`;

  el.querySelectorAll(".vote-status-select").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const id = sel.dataset.id;
      const newStatus = sel.value;
      try {
        await adminFetch(`/votes/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        });
        showToast(`Vote payment #${id} updated to ${newStatus}.`, "success");
        loadAll(false);
      } catch (err) {
        showToast(err.message || "Could not update vote payment.", "error");
      }
    });
  });
}

// ===========================================================================
// GALLERY
// ===========================================================================
function renderGalleryView() {
  const el = document.getElementById("view-gallery");
  el.innerHTML = `
    <div class="admin-panel">
      <div class="admin-panel-head">
        <div><h2>Upload Photo</h2><p class="muted">JPEG, PNG, or WebP, up to 8MB. Appears on the public Gallery page immediately.</p></div>
      </div>
      <form id="gallery-upload-form">
        <div class="field"><label for="galleryPhoto">Photo</label><input type="file" id="galleryPhoto" accept="image/jpeg,image/png,image/webp" required /></div>
        <div class="field"><label for="galleryCaption">Caption (optional)</label><input type="text" id="galleryCaption" placeholder="e.g. Last year's masquerade theme" /></div>
        <button type="submit" class="btn btn-primary" id="gallery-upload-btn">Upload Photo</button>
      </form>
    </div>
    <div class="admin-panel">
      <div class="admin-panel-head"><h2>Gallery (${state.galleryPhotos.length})</h2></div>
      ${
        state.galleryPhotos.length === 0
          ? `<p class="muted">No photos uploaded yet.</p>`
          : `<div class="admin-gallery-grid" id="admin-gallery-grid">
        ${state.galleryPhotos
          .map(
            (p) => `
          <div class="admin-gallery-item" data-id="${p.id}">
            <img src="${ADMIN_ORIGIN}${p.url}" alt="${escapeHtml(p.caption || "Event photo")}" />
            <button type="button" class="delete-photo" data-id="${p.id}">Delete</button>
          </div>`
          )
          .join("")}
      </div>`
      }
    </div>`;

  document.getElementById("gallery-upload-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fileInput = document.getElementById("galleryPhoto");
    const caption = document.getElementById("galleryCaption").value.trim();
    if (!fileInput.files[0]) return;

    const btn = document.getElementById("gallery-upload-btn");
    btn.disabled = true;
    btn.textContent = "Uploading...";
    const formData = new FormData();
    formData.append("photo", fileInput.files[0]);
    if (caption) formData.append("caption", caption);

    try {
      await adminFetchForm("/gallery", formData);
      showToast("Photo uploaded.", "success");
      loadAll(false);
    } catch (err) {
      showToast(err.message || "Upload failed.", "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Upload Photo";
    }
  });

  el.querySelectorAll(".delete-photo").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this photo? This can't be undone.")) return;
      try {
        await adminFetch(`/gallery/${btn.dataset.id}`, { method: "DELETE" });
        showToast("Photo deleted.", "success");
        loadAll(false);
      } catch (err) {
        showToast(err.message || "Could not delete photo.", "error");
      }
    });
  });
}

// ===========================================================================
// REPORTS
// ===========================================================================
function renderReports() {
  const el = document.getElementById("view-reports");
  const s = state.stats;

  el.innerHTML = `
    <div class="admin-panel">
      <div class="admin-panel-head"><div><h2>Revenue Report</h2><p class="muted">${money(s?.revenue.totalGhs || 0)} total confirmed revenue</p></div></div>
      <div class="modal-actions" style="flex-direction:row;flex-wrap:wrap">
        <button class="btn btn-outline-dark btn-sm" id="export-revenue-csv">Export CSV</button>
        <button class="btn btn-outline-dark btn-sm" id="print-report">Export PDF (Print)</button>
      </div>
    </div>

    <div class="admin-panel">
      <div class="admin-panel-head"><h2>Ticket Sales Report</h2></div>
      <button class="btn btn-outline-dark btn-sm" id="export-orders-csv">Export Ticket Orders CSV</button>
    </div>

    <div class="admin-panel">
      <div class="admin-panel-head"><h2>Payment Report</h2></div>
      <button class="btn btn-outline-dark btn-sm" id="export-payments-csv">Export Payments CSV</button>
    </div>

    <div class="admin-panel">
      <div class="admin-panel-head"><h2>Voting Report</h2></div>
      <button class="btn btn-outline-dark btn-sm" id="export-votes-csv">Export Vote Payments CSV</button>
    </div>

    <div class="admin-panel">
      <div class="admin-panel-head"><h2>Attendance Report</h2></div>
      <button class="btn btn-outline-dark btn-sm" id="export-attendees-csv">Export Attendees CSV</button>
    </div>`;

  document.getElementById("export-revenue-csv").addEventListener("click", () => {
    const rows = (s?.revenue.series || []).map((r) => [r.day, r.tickets, r.revenue]);
    downloadCsv("amor-regius-revenue.csv", ["Date", "Tickets Sold", "Revenue (GHS)"], rows);
  });
  document.getElementById("print-report").addEventListener("click", () => window.print());
  document.getElementById("export-orders-csv").addEventListener("click", () => {
    const rows = state.orders.map((o) => [o.id, o.buyer_name, o.buyer_email, o.ticket_type, o.quantity, o.amount_ghs, o.status, o.financial_transaction_id, o.created_at]);
    downloadCsv("amor-regius-ticket-orders.csv", ["Order ID", "Customer", "Email", "Ticket Type", "Quantity", "Amount (GHS)", "Status", "Payment Ref", "Date"], rows);
  });
  document.getElementById("export-payments-csv").addEventListener("click", () => {
    const rows = getUnifiedPayments().map((r) => [r.id, r.customer, r.email, r.item, r.amount, r.txn, r.status, r.date]);
    downloadCsv("amor-regius-payments.csv", ["Reference", "Customer", "Email", "Item", "Amount (GHS)", "Payment Ref", "Status", "Date"], rows);
  });
  document.getElementById("export-votes-csv").addEventListener("click", () => {
    const rows = state.votePayments.map((p) => [p.id, p.voter_name, p.voter_phone, p.category_name, p.nominee_name, p.quantity, p.amount_ghs, p.status, p.created_at]);
    downloadCsv("amor-regius-vote-payments.csv", ["ID", "Voter", "Phone", "Category", "Nominee", "Votes", "Amount (GHS)", "Status", "Date"], rows);
  });
  document.getElementById("export-attendees-csv").addEventListener("click", () => {
    const rows = state.orders.filter((o) => o.status === "confirmed").map((o) => [o.buyer_name, o.buyer_email, o.ticket_type, o.quantity, o.status, o.ticket_sent_at ? "Sent" : "Not sent", o.created_at]);
    downloadCsv("amor-regius-attendees.csv", ["Name", "Email", "Ticket Type", "Quantity", "Payment Status", "Ticket Delivery", "Registered"], rows);
  });
}

// ===========================================================================
// SETTINGS (read-only configuration status - never displays secrets)
// ===========================================================================
async function renderSettings() {
  const el = document.getElementById("view-settings");
  el.innerHTML = `<div class="admin-panel"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-row"></div></div>`;

  try {
    const [config, pricing] = await Promise.all([apiGet("/config"), apiGet("/tickets/pricing")]);
    el.innerHTML = `
      <div class="admin-panel">
        <div class="admin-panel-head"><h2>Event Configuration</h2></div>
        <div class="settings-row"><div><div class="settings-row-label">Event Name</div></div><div>${escapeHtml(config.eventName)}</div></div>
        <div class="settings-row"><div><div class="settings-row-label">Date</div></div><div>${escapeHtml(config.eventDateLine)}</div></div>
        <div class="settings-row"><div><div class="settings-row-label">Organizer</div></div><div>${escapeHtml(config.orgName)}</div></div>
      </div>
      <div class="admin-panel">
        <div class="admin-panel-head"><h2>Ticket Pricing</h2></div>
        <div class="settings-row"><div class="settings-row-label">Single</div><div>${money(pricing.prices.single)}</div></div>
        <div class="settings-row"><div class="settings-row-label">Double</div><div>${money(pricing.prices.double)}</div></div>
        <div class="settings-row"><div class="settings-row-label">Executive</div><div>${money(pricing.prices.executive)}</div></div>
        <p class="muted" style="margin-top:10px">Prices are set via environment variables on the server and shown here read-only.</p>
      </div>
      <div class="admin-panel">
        <div class="admin-panel-head"><h2>Service Configuration</h2></div>
        <div class="settings-row"><div class="settings-row-label">Paystack</div><span class="health-status ${config.paystackConfigured ? "health-ok" : "health-off"}">${config.paystackConfigured ? "Configured" : "Not configured"}</span></div>
        <div class="settings-row"><div class="settings-row-label">Ticket Email Delivery</div><span class="health-status ${config.emailConfigured ? "health-ok" : "health-off"}">${config.emailConfigured ? "Configured" : "Not configured"}</span></div>
        <p class="muted" style="margin-top:10px">Credentials and secrets are never exposed here - only whether each service is configured.</p>
      </div>
      <div class="admin-panel">
        <div class="admin-panel-head"><h2>Admin Session</h2></div>
        <p class="muted">Your admin key is kept only in this browser tab's session storage and is never written to the page URL or logs. Closing this tab clears it.</p>
        <button class="btn btn-outline-dark btn-sm" id="settings-logout">Sign Out</button>
      </div>`;
    document.getElementById("settings-logout").addEventListener("click", () => {
      clearAdminKey();
      showLogin();
    });
  } catch (err) {
    el.innerHTML = `<div class="admin-panel"><div class="state-block state-error"><h3>Unable to load settings</h3><p>${escapeHtml(err.message)}</p></div></div>`;
  }
}

// ===========================================================================
// GLOBAL SEARCH
// ===========================================================================
const searchInput = document.getElementById("global-search");
const searchResults = document.getElementById("global-search-results");

searchInput.addEventListener("input", () => {
  const q = searchInput.value.trim().toLowerCase();
  if (q.length < 2) {
    searchResults.classList.add("hidden");
    return;
  }

  const orderMatches = state.orders
    .filter((o) => o.buyer_name?.toLowerCase().includes(q) || o.buyer_email?.toLowerCase().includes(q) || String(o.id).includes(q) || o.financial_transaction_id?.toLowerCase().includes(q))
    .slice(0, 5);
  const voteMatches = state.votePayments
    .filter((p) => p.voter_name?.toLowerCase().includes(q) || p.nominee_name?.toLowerCase().includes(q) || p.financial_transaction_id?.toLowerCase().includes(q))
    .slice(0, 5);

  if (orderMatches.length === 0 && voteMatches.length === 0) {
    searchResults.innerHTML = `<div style="padding:14px" class="muted">No matches found.</div>`;
    searchResults.classList.remove("hidden");
    return;
  }

  searchResults.innerHTML = `
    ${
      orderMatches.length
        ? `<div style="padding:8px 14px;font-size:0.7rem;text-transform:uppercase;color:var(--muted);letter-spacing:0.06em">Ticket Orders</div>` +
          orderMatches.map((o) => `<div class="search-result-item" data-type="order" data-id="${o.id}" style="padding:9px 14px;cursor:pointer;font-size:0.85rem">#${o.id} &middot; ${escapeHtml(o.buyer_name)} &middot; ${money(o.amount_ghs)}</div>`).join("")
        : ""
    }
    ${
      voteMatches.length
        ? `<div style="padding:8px 14px;font-size:0.7rem;text-transform:uppercase;color:var(--muted);letter-spacing:0.06em">Vote Payments</div>` +
          voteMatches.map((p) => `<div class="search-result-item" data-type="vote" data-id="${p.id}" style="padding:9px 14px;cursor:pointer;font-size:0.85rem">${escapeHtml(p.voter_name || "Anonymous")} &middot; ${escapeHtml(p.nominee_name)}</div>`).join("")
        : ""
    }`;
  searchResults.classList.remove("hidden");

  searchResults.querySelectorAll(".search-result-item").forEach((item) => {
    item.addEventListener("mouseenter", () => (item.style.background = "#fdf8e9"));
    item.addEventListener("mouseleave", () => (item.style.background = ""));
    item.addEventListener("click", () => {
      searchResults.classList.add("hidden");
      searchInput.value = "";
      if (item.dataset.type === "order") {
        setView("orders");
        setTimeout(() => openOrderDrawer(Number(item.dataset.id)), 50);
      } else {
        setView("voting");
      }
    });
  });
});

document.addEventListener("click", (e) => {
  if (!searchResults.contains(e.target) && e.target !== searchInput) {
    searchResults.classList.add("hidden");
  }
});

// ---------------------------------------------------------------------------
// BOOTSTRAP
// ---------------------------------------------------------------------------
(function init() {
  if (getAdminKey()) {
    showShell();
    initAdminName();
    setView(window.location.hash.replace("#", "") || "dashboard");
    loadAll(true);
  } else {
    showLogin();
  }
})();
