const path = require("path");
const Database = require("better-sqlite3");

const db = new Database(path.join(__dirname, "data", "rosa.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS nominees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    name TEXT NOT NULL,
    votes INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS admin_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gallery_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    caption TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS vote_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nominee_id INTEGER NOT NULL REFERENCES nominees(id),
    quantity INTEGER NOT NULL,
    amount_ghs REAL NOT NULL,
    voter_name TEXT,
    voter_phone TEXT,
    network TEXT,
    client_reference TEXT NOT NULL,
    financial_transaction_id TEXT,
    last_status_payload TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ticket_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    buyer_name TEXT NOT NULL,
    buyer_phone TEXT NOT NULL,
    buyer_email TEXT,
    ticket_type TEXT NOT NULL CHECK (ticket_type IN ('single','double','executive')),
    quantity INTEGER NOT NULL,
    amount_ghs REAL NOT NULL,
    network TEXT,
    client_reference TEXT NOT NULL,
    financial_transaction_id TEXT,
    last_status_payload TEXT,
    ticket_sent_at TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// --- Migrations for databases created before earlier payment integrations ---
// SQLite can't add/rename columns with certain constraints in one step, so
// this brings an older ticket_orders/vote_payments table up to the current
// shape without losing any existing rows.

function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

for (const table of ["ticket_orders", "vote_payments"]) {
  if (hasColumn(table, "momo_reference") && !hasColumn(table, "client_reference")) {
    db.exec(`ALTER TABLE ${table} RENAME COLUMN momo_reference TO client_reference`);
  }
  if (!hasColumn(table, "network")) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN network TEXT`);
  }
  if (hasColumn(table, "hubtel_transaction_id") && !hasColumn(table, "financial_transaction_id")) {
    db.exec(`ALTER TABLE ${table} RENAME COLUMN hubtel_transaction_id TO financial_transaction_id`);
  }
  if (!hasColumn(table, "financial_transaction_id")) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN financial_transaction_id TEXT`);
  }
  if (hasColumn(table, "webhook_payload") && !hasColumn(table, "last_status_payload")) {
    db.exec(`ALTER TABLE ${table} RENAME COLUMN webhook_payload TO last_status_payload`);
  }
  if (!hasColumn(table, "last_status_payload")) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN last_status_payload TEXT`);
  }
}

if (!hasColumn("ticket_orders", "ticket_sent_at")) {
  db.exec(`ALTER TABLE ticket_orders ADD COLUMN ticket_sent_at TEXT`);
}

if (!hasColumn("vote_payments", "status")) {
  // The column default must be 'pending' so it applies correctly to every
  // vote inserted from now on. Rows that already existed before this
  // migration were counted immediately under the old honor-system flow
  // (pre-payment-gateway), so a one-time backfill (not the column default)
  // marks exactly those as 'confirmed' - otherwise the pending->confirmed
  // guard would never fire for new votes, and their tally would never be
  // added.
  db.exec(
    `ALTER TABLE vote_payments ADD COLUMN status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected'))`
  );
  db.exec(`UPDATE vote_payments SET status = 'confirmed'`);
}

// Older ticket_orders CHECK constraint predates the 'executive' ticket type -
// SQLite can't ALTER a CHECK constraint in place, so rebuild the table.
const existingSchema = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'ticket_orders'").get();
if (existingSchema && !existingSchema.sql.includes("'executive'")) {
  db.transaction(() => {
    db.exec(`
      ALTER TABLE ticket_orders RENAME TO ticket_orders_old;

      CREATE TABLE ticket_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        buyer_name TEXT NOT NULL,
        buyer_phone TEXT NOT NULL,
        buyer_email TEXT,
        ticket_type TEXT NOT NULL CHECK (ticket_type IN ('single','double','executive')),
        quantity INTEGER NOT NULL,
        amount_ghs REAL NOT NULL,
        network TEXT,
        client_reference TEXT NOT NULL,
        financial_transaction_id TEXT,
        last_status_payload TEXT,
        ticket_sent_at TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO ticket_orders (id, buyer_name, buyer_phone, buyer_email, ticket_type, quantity, amount_ghs, network, client_reference, financial_transaction_id, last_status_payload, ticket_sent_at, status, created_at)
      SELECT id, buyer_name, buyer_phone, buyer_email, ticket_type, quantity, amount_ghs, network, client_reference, financial_transaction_id, last_status_payload, ticket_sent_at, status, created_at FROM ticket_orders_old;

      DROP TABLE ticket_orders_old;
    `);
  })();
}

module.exports = db;
