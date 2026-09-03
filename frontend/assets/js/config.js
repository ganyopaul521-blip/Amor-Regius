// Backend API origin. Local dev (localhost/127.0.0.1) keeps working against
// the backend on port 4000 unchanged. Everywhere else - i.e. once this is
// deployed on Vercel - it points at the Render-hosted backend below. Update
// RENDER_BACKEND_URL after the backend's first Render deploy.
(function () {
  const RENDER_BACKEND_URL = "https://amor-regius-backend.onrender.com";
  const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  window.ROSA_API_BASE = isLocal ? "http://localhost:4000/api" : `${RENDER_BACKEND_URL}/api`;
})();
