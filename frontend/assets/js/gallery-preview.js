// Homepage gallery preview: shows a handful of real photos from /api/gallery
// (the same data source as the full gallery.html page) with a link through
// to the complete collection.
async function loadGalleryPreview() {
  const grid = document.getElementById("gallery-preview-grid");
  const empty = document.getElementById("gallery-preview-empty");
  if (!grid) return;

  try {
    const data = await apiGet("/gallery");
    const photos = data.photos.slice(0, 6);

    if (photos.length === 0) {
      empty.classList.remove("hidden");
      return;
    }

    grid.innerHTML = photos
      .map(
        (photo) => `
        <a class="gallery-item" href="gallery.html" aria-label="${photo.caption ? photo.caption.replace(/"/g, "&quot;") : "View full gallery"}">
          <img src="${photo.url}" alt="${photo.caption ? photo.caption.replace(/"/g, "&quot;") : "Amor Regius event photo"}" loading="lazy" />
          ${photo.caption ? `<div class="gallery-caption">${photo.caption}</div>` : ""}
        </a>`
      )
      .join("");
  } catch (err) {
    empty.textContent = "Could not load the gallery preview right now.";
    empty.classList.remove("hidden");
  }
}

loadGalleryPreview();
