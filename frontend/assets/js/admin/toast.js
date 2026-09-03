// Lightweight toast notifications for the admin control center.
const toastStack = (() => {
  let el = document.getElementById("toast-stack");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast-stack";
    el.className = "toast-stack";
    document.body.appendChild(el);
  }
  return el;
})();

const TOAST_ICONS = {
  success: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>',
  error: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2 1 21h22L12 2zm0 15a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4zm1-4h-2v-5h2v5z"/></svg>',
  info: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M11 7h2v2h-2V7zm0 4h2v6h-2v-6zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/></svg>',
};

function showToast(message, type = "info", duration = 4000) {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `${TOAST_ICONS[type] || TOAST_ICONS.info}<span>${message}</span>`;
  toastStack.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = "opacity 0.25s ease";
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 250);
  }, duration);
}
