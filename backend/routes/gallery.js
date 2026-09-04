const express = require("express");
const db = require("../db");

const router = express.Router();

// GET /api/gallery - public list of past-event photos, newest first. url is
// already a full Cloudinary URL (set at upload time in routes/admin.js).
router.get("/", async (req, res) => {
  const photos = await db.prepare("SELECT id, url, caption, created_at FROM gallery_photos ORDER BY id DESC").all();
  res.json({
    photos: photos.map((p) => ({
      id: p.id,
      url: p.url,
      caption: p.caption,
      createdAt: p.created_at,
    })),
  });
});

module.exports = router;
