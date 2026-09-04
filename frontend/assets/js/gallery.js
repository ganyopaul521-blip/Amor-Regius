const gridEl = document.getElementById("gallery-grid");
const emptyEl = document.getElementById("gallery-empty");
const lightbox = document.getElementById("lightbox");
const lightboxImage = document.getElementById("lightbox-image");
const lightboxCaption = document.getElementById("lightbox-caption");
const lightboxCounter = document.getElementById("lightbox-counter");

let photos = [];
let currentIndex = 0;
let lastFocusedEl = null;

function openLightbox(index) {
  lastFocusedEl = document.activeElement;
  currentIndex = index;
  const photo = photos[currentIndex];
  lightboxImage.src = photo.url;
  lightboxImage.alt = photo.caption || "Amor Regius event photo";
  lightboxCaption.textContent = photo.caption || "";
  lightboxCounter.textContent = `${currentIndex + 1} / ${photos.length}`;
  lightbox.classList.remove("hidden");
  document.getElementById("lightbox-close").focus();
}

function closeLightbox() {
  lightbox.classList.add("hidden");
  if (lastFocusedEl) lastFocusedEl.focus();
}

function showRelative(delta) {
  currentIndex = (currentIndex + delta + photos.length) % photos.length;
  openLightbox(currentIndex);
}

document.getElementById("lightbox-close").addEventListener("click", closeLightbox);
document.getElementById("lightbox-prev").addEventListener("click", () => showRelative(-1));
document.getElementById("lightbox-next").addEventListener("click", () => showRelative(1));
lightbox.addEventListener("click", (e) => {
  if (e.target === lightbox) closeLightbox();
});
document.addEventListener("keydown", (e) => {
  if (lightbox.classList.contains("hidden")) return;
  if (e.key === "Escape") closeLightbox();
  if (e.key === "ArrowLeft") showRelative(-1);
  if (e.key === "ArrowRight") showRelative(1);
});

// swipe support
let touchStartX = null;
lightbox.addEventListener("touchstart", (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
lightbox.addEventListener(
  "touchend",
  (e) => {
    if (touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 40) dx > 0 ? showRelative(-1) : showRelative(1);
    touchStartX = null;
  },
  { passive: true }
);

async function loadGallery() {
  try {
    const data = await apiGet("/gallery");
    photos = data.photos;

    if (photos.length === 0) {
      emptyEl.classList.remove("hidden");
      return;
    }

    gridEl.innerHTML = photos
      .map(
        (photo, index) => `
        <div class="gallery-item" data-index="${index}" role="button" tabindex="0"
             aria-label="${photo.caption ? photo.caption.replace(/"/g, "&quot;") : `Photo ${index + 1}`}, view full size"
             style="animation-delay:${Math.min(index * 0.06, 0.6)}s">
          <img src="${photo.url}" alt="${photo.caption ? photo.caption.replace(/"/g, "&quot;") : "Event photo"}" loading="lazy" />
          ${photo.caption ? `<div class="gallery-caption">${photo.caption}</div>` : ""}
        </div>`
      )
      .join("");

    gridEl.querySelectorAll(".gallery-item").forEach((el) => {
      el.addEventListener("click", () => openLightbox(Number(el.dataset.index)));
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openLightbox(Number(el.dataset.index));
        }
      });
    });
  } catch (err) {
    emptyEl.textContent = "Could not load the gallery. Is the backend running?";
    emptyEl.classList.remove("hidden");
  }
}

loadGallery();
