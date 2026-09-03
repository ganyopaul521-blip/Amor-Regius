// Minimal, dependency-free SVG bar chart. The project has no charting
// library already installed, and pulling one in just for a single revenue
// chart isn't worth the extra dependency - this covers exactly what's needed.

function renderBarChart(container, points, { formatValue = (v) => v, barColor = "#d9a928" } = {}) {
  if (!points.length) {
    container.innerHTML = '<div class="chart-empty">No revenue recorded yet for this period.</div>';
    return;
  }

  const width = Math.max(320, points.length * 56);
  const height = 220;
  const paddingBottom = 34;
  const paddingTop = 16;
  const paddingLeft = 8;
  const barGap = 14;
  const plotHeight = height - paddingBottom - paddingTop;
  const barWidth = Math.max(18, (width - paddingLeft * 2) / points.length - barGap);

  const maxValue = Math.max(...points.map((p) => p.value), 1);

  const bars = points
    .map((p, i) => {
      const barHeight = Math.max(2, (p.value / maxValue) * plotHeight);
      const x = paddingLeft + i * (barWidth + barGap);
      const y = paddingTop + (plotHeight - barHeight);
      return `
        <g class="chart-bar-group">
          <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="4" fill="${barColor}">
            <title>${p.label}: ${formatValue(p.value)}</title>
          </rect>
          <text x="${x + barWidth / 2}" y="${height - 12}" text-anchor="middle" font-size="10" fill="#766c5c">${p.label}</text>
        </g>`;
    })
    .join("");

  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Revenue chart">${bars}</svg>`;
}

// Groups an array of {day: 'YYYY-MM-DD', revenue, tickets} rows (as returned
// by GET /api/admin/stats) into daily/weekly/monthly buckets.
function groupRevenueSeries(series, granularity) {
  if (granularity === "daily") {
    return series.map((row) => ({ label: formatShortDate(row.day), value: row.revenue }));
  }

  const buckets = new Map();
  series.forEach((row) => {
    const date = new Date(row.day + "T00:00:00Z");
    let key, label;
    if (granularity === "weekly") {
      const weekStart = new Date(date);
      weekStart.setUTCDate(date.getUTCDate() - date.getUTCDay());
      key = weekStart.toISOString().slice(0, 10);
      label = formatShortDate(key);
    } else {
      key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
      label = date.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
    }
    const existing = buckets.get(key);
    buckets.set(key, { label, value: (existing ? existing.value : 0) + row.revenue });
  });

  return Array.from(buckets.values());
}

function formatShortDate(isoDate) {
  const d = new Date(isoDate + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
}
