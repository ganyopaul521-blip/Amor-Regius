const express = require("express");
const db = require("../db");

const router = express.Router();

// GET /api/gallery - public list of past-event photos, newest first
router.get("/", (req, res) => {
  const photos = db.prepare("SELECT id, filename, caption, created_at FROM gallery_photos ORDER BY id DESC").all();
  res.json({
    photos: photos.map((p) => ({
      id: p.id,
      url: `/uploads/gallery/${p.filename}`,
      caption: p.caption,
      createdAt: p.created_at,
    })),
  });
});

module.exports = router;
