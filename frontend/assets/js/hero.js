// Homepage hero: a slideshow built from real images (the event poster plus
// whatever photos exist in the gallery - see /api/gallery, populated from
// admin.html's upload form), and a countdown to the real event date.

const HERO_EVENT_DATE = new Date("2026-09-20T18:00:00Z"); // Sun 20 Sep 2026, 6pm - Ghana is UTC+0 year-round
const SLIDE_INTERVAL_MS = 3000;

const BACKEND_ORIGIN = API_BASE.replace(/\/api$/, "");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const slidesEl = document.getElementById("hero-slides");
const dotsEl = document.getElementById("hero-dots");
const prevBtn = document.getElementById("hero-prev");
const nextBtn = document.getElementById("hero-next");
const heroEl = document.querySelector(".hero");

let slideEls = [];
let dotEls = [];
let current = 0;
let autoplayTimer = null;

function buildSlide(src, alt, isFirst) {
  const div = document.createElement("div");
  div.className = "hero-slide";
  const img = document.createElement("img");
  img.className = "hero-slide-img";
  img.src = src;
  img.alt = alt;
  img.loading = isFirst ? "eager" : "lazy";
  div.appendChild(img);
  return div;
}

function renderSlides(sources) {
  slidesEl.innerHTML = "";
  dotsEl.innerHTML = "";

  slideEls = sources.map((s, i) => {
    const el = buildSlide(s.src, s.alt, i === 0);
    slidesEl.appendChild(el);
    return el;
  });

  dotEls = sources.map((_, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-label", `Go to slide ${i + 1}`);
    b.addEventListener("click", () => goTo(i));
    dotsEl.appendChild(b);
    return b;
  });

  const showControls = sources.length > 1;
  prevBtn.classList.toggle("hidden", !showControls);
  nextBtn.classList.toggle("hidden", !showControls);
  dotsEl.classList.toggle("hidden", !showControls);

  goTo(0);
  if (showControls) startAutoplay();
}

function goTo(index) {
  current = (index + slideEls.length) % slideEls.length;
  slideEls.forEach((el, i) => el.classList.toggle("active", i === current));
  dotEls.forEach((el, i) => el.classList.toggle("active", i === current));
}

function next() {
  goTo(current + 1);
}

function prev() {
  goTo(current - 1);
}

function startAutoplay() {
  if (reducedMotion) return;
  stopAutoplay();
  autoplayTimer = setInterval(next, SLIDE_INTERVAL_MS);
}

function stopAutoplay() {
  if (autoplayTimer) clearInterval(autoplayTimer);
  autoplayTimer = null;
}

prevBtn.addEventListener("click", () => {
  prev();
  startAutoplay();
});
nextBtn.addEventListener("click", () => {
  next();
  startAutoplay();
});

heroEl.addEventListener("mouseenter", stopAutoplay);
heroEl.addEventListener("mouseleave", startAutoplay);
heroEl.addEventListener("focusin", stopAutoplay);
heroEl.addEventListener("focusout", startAutoplay);

heroEl.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") {
    prev();
    startAutoplay();
  } else if (e.key === "ArrowRight") {
    next();
    startAutoplay();
  }
});

// touch/swipe support
let touchStartX = null;
heroEl.addEventListener(
  "touchstart",
  (e) => {
    touchStartX = e.touches[0].clientX;
  },
  { passive: true }
);
heroEl.addEventListener(
  "touchend",
  (e) => {
    if (touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 40) {
      dx > 0 ? prev() : next();
      startAutoplay();
    }
    touchStartX = null;
  },
  { passive: true }
);

async function loadSlides() {
  // The poster itself is deliberately excluded here - its own baked-in
  // "Amor Regius" title would visually collide with the title overlaid on
  // top of every slide. It gets its own dedicated spot in the About section
  // instead. Real gallery photos (uploaded via admin.html) don't have that
  // problem, so they're what the slideshow actually rotates through.
  const sources = [];

  try {
    const data = await apiGet("/gallery");
    data.photos.slice(0, 6).forEach((p) => {
      sources.push({ src: `${BACKEND_ORIGIN}${p.url}`, alt: p.caption || "Amor Regius event photo" });
    });
  } catch (err) {
    // backend unreachable - fall through to the no-photos gradient slide below
  }

  if (sources.length === 0) {
    heroEl.classList.add("hero-no-photos");
  }

  renderSlides(sources);
}

loadSlides();

// ---- countdown ----
const cdDays = document.getElementById("cd-days");
const cdHours = document.getElementById("cd-hours");
const cdMinutes = document.getElementById("cd-minutes");
const cdSeconds = document.getElementById("cd-seconds");
const cdWrap = document.getElementById("countdown");
const cdGrid = document.getElementById("countdown-grid");

function pad(n) {
  return String(n).padStart(2, "0");
}

function tickCountdown() {
  const diff = HERO_EVENT_DATE.getTime() - Date.now();

  if (diff <= 0) {
    cdGrid.classList.add("hidden");
    cdWrap.classList.add("finished");
    cdWrap.textContent = "The night has arrived — thank you for celebrating Amor Regius with us!";
    clearInterval(countdownTimer);
    return;
  }

  const seconds = Math.floor(diff / 1000);
  cdDays.textContent = pad(Math.floor(seconds / 86400));
  cdHours.textContent = pad(Math.floor((seconds % 86400) / 3600));
  cdMinutes.textContent = pad(Math.floor((seconds % 3600) / 60));
  cdSeconds.textContent = pad(seconds % 60);
}

tickCountdown();
const countdownTimer = setInterval(tickCountdown, 1000);
