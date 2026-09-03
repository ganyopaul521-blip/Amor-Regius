// Base URL of the backend API. Change this if the backend is deployed
// somewhere other than localhost:4000.
const API_BASE = window.ROSA_API_BASE || "http://localhost:4000/api";

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error((await res.json()).error || "Request failed");
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
