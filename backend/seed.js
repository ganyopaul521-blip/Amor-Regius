// Seeds award categories and nominees.
require("dotenv").config();
const db = require("./db");

const CATEGORIES = [
  {
    name: "Most Committed Member",
    nominees: ["Samuel Sowu", "Leonard Gbekie", "Angela Brew", "Paul Ganyo"],
  },
  {
    name: "Department of the Year",
    nominees: ["Music", "Media", "Ushering", "Prayer"],
  },
  {
    name: "Executive of the Year",
    nominees: ["Paul Ganyo", "Leonard Gbekie", "Angela Brew"],
  },
];

async function seed() {
  for (const cat of CATEGORIES) {
    await db.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)").run(cat.name);
    const { id: categoryId } = await db.prepare("SELECT id FROM categories WHERE name = ?").get(cat.name);
    const { n } = await db.prepare("SELECT COUNT(*) AS n FROM nominees WHERE category_id = ?").get(categoryId);
    if (n === 0) {
      for (const nomineeName of cat.nominees) {
        await db.prepare("INSERT INTO nominees (category_id, name) VALUES (?, ?)").run(categoryId, nomineeName);
      }
      console.log(`Seeded ${cat.nominees.length} nominees for "${cat.name}"`);
    } else {
      console.log(`Skipped "${cat.name}" - nominees already exist`);
    }
  }
}

module.exports = seed().then(() => console.log("Done."));
