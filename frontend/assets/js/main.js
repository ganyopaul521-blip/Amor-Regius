// Shared behavior across every page: sticky-header scroll state, the mobile
// nav menu, scroll-reveal animations, and the footer's dynamic year.

(function stickyHeader() {
  const header = document.querySelector("header.site-header");
  if (!header) return;
  const onScroll = () => header.classList.toggle("scrolled", window.scrollY > 12);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
})();

(function mobileNav() {
  const toggle = document.getElementById("nav-toggle");
  const nav = document.querySelector("nav.tabs");
  const scrim = document.getElementById("nav-scrim");
  if (!toggle || !nav) return;

  function closeMenu() {
    nav.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
    if (scrim) scrim.classList.remove("open");
    document.body.style.overflow = "";
  }

  function openMenu() {
    nav.classList.add("open");
    toggle.setAttribute("aria-expanded", "true");
    if (scrim) scrim.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  toggle.addEventListener("click", () => {
    const isOpen = nav.classList.contains("open");
    isOpen ? closeMenu() : openMenu();
  });

  if (scrim) scrim.addEventListener("click", closeMenu);
  nav.querySelectorAll("a").forEach((a) => a.addEventListener("click", closeMenu));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });
})();

(function scrollReveal() {
  // Elements start fully visible (see the base [data-animate] CSS - it has
  // no opacity/transform of its own). Only once we know the observer can
  // run do we opt them into the hide-then-reveal effect, so a JS error or
  // slow script load can never leave real content stuck invisible.
  const targets = document.querySelectorAll("[data-animate]");
  if (!targets.length) return;
  if (!("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  targets.forEach((el) => el.classList.add("reveal-pending"));

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in-view");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
  );

  targets.forEach((el) => observer.observe(el));
})();

(function footerYear() {
  const el = document.getElementById("footer-year");
  if (el) el.textContent = new Date().getFullYear();
})();
