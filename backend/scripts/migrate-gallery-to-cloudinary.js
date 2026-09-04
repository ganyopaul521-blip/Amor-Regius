// One-time migration: uploads the local gallery photos (from before the
// switch to Turso + Cloudinary) to Cloudinary, and records them in the new
// database. Run once: node scripts/migrate-gallery-to-cloudinary.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const cloudinary = require("cloudinary").v2;
const db = require("../db");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const OLD_DB_PATH = path.join(__dirname, "..", "data", "rosa.db");
const OLD_GALLERY_DIR = path.join(__dirname, "..", "uploads", "gallery");

async function migrate() {
  const oldDb = new Database(OLD_DB_PATH, { readonly: true });
  const photos = oldDb.prepare("SELECT * FROM gallery_photos ORDER BY id").all();
  oldDb.close();

  console.log(`Found ${photos.length} photos in the old local database.`);

  for (const photo of photos) {
    const filePath = path.join(OLD_GALLERY_DIR, photo.filename);
    if (!fs.existsSync(filePath)) {
      console.log(`Skipping #${photo.id} (${photo.filename}) - file missing on disk`);
      continue;
    }

    const uploaded = await cloudinary.uploader.upload(filePath, { folder: "amor-regius-gallery" });
    await db
      .prepare("INSERT INTO gallery_photos (url, cloudinary_public_id, caption) VALUES (?, ?, ?)")
      .run(uploaded.secure_url, uploaded.public_id, photo.caption);
    console.log(`Migrated #${photo.id} -> ${uploaded.secure_url}`);
  }

  console.log("Done.");
}

module.exports = migrate();
