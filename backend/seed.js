// Seeds award categories with placeholder nominees.
// Edit the CATEGORIES list below with real nominee names, then run:
//   npm run seed
const db = require("./db");

const CATEGORIES = [
  {
    name: "Most Influential Member of the Year",
    nominees: ["Nominee A", "Nominee B", "Nominee C", "Nominee D"],
  },
  {
    name: "Department of the Year",
    nominees: ["Department A", "Department B", "Department C"],
  },
  {
    name: "Executive of the Year",
    nominees: ["Executive A", "Executive B", "Executive C", "Executive D"],
  },
];

const insertCategory = db.prepare(
  "INSERT OR IGNORE INTO categories (name) VALUES (?)"
);
const getCategory = db.prepare("SELECT id FROM categories WHERE name = ?");
const insertNominee = db.prepare(
  "INSERT INTO nominees (category_id, name) VALUES (?, ?)"
);
const countNominees = db.prepare(
  "SELECT COUNT(*) AS n FROM nominees WHERE category_id = ?"
);

const seed = db.transaction(() => {
  for (const cat of CATEGORIES) {
    insertCategory.run(cat.name);
    const { id: categoryId } = getCategory.get(cat.name);
    const { n } = countNominees.get(categoryId);
    if (n === 0) {
      for (const nomineeName of cat.nominees) {
        insertNominee.run(categoryId, nomineeName);
      }
      console.log(`Seeded ${cat.nominees.length} nominees for "${cat.name}"`);
    } else {
      console.log(`Skipped "${cat.name}" - nominees already exist`);
    }
  }
});

seed();
console.log("Done.");
