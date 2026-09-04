// Turso (libSQL - a SQLite-compatible hosted database) replaces the local
// better-sqlite3 file. This keeps the same SQL dialect and the same
// db.prepare(sql).get/all/run(...) call shape used throughout the route
// files, so callers only needed `await` added at each call site - no SQL
// string changes. See db.transaction() below for the one shape that did
// need a small change at its 2 call sites.
const { createClient } = require("@libsql/client");

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Ungated - only for the schema setup below. Everything else goes through
// prepare()/transaction(), which await `ready` first so callers never race
// table creation.
async function rawExec(sqlScript) {
  return client.executeMultiple(sqlScript);
}

const ready = (async () => {
  await rawExec(`
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
      url TEXT NOT NULL,
      cloudinary_public_id TEXT NOT NULL,
      caption TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS vote_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nominee_id INTEGER NOT NULL REFERENCES nominees(id),
      quantity INTEGER NOT NULL,
      amount_ghs REAL NOT NULL,
      base_amount_ghs REAL,
      voter_name TEXT,
      voter_phone TEXT,
      voter_email TEXT,
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
      base_amount_ghs REAL,
      network TEXT,
      client_reference TEXT NOT NULL,
      financial_transaction_id TEXT,
      last_status_payload TEXT,
      ticket_sent_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
})();

function buildPrepare(executeFn) {
  return function prepare(sql) {
    return {
      get: async (...args) => {
        const r = await executeFn(sql, args);
        return r.rows[0];
      },
      all: async (...args) => {
        const r = await executeFn(sql, args);
        return r.rows;
      },
      run: async (...args) => {
        const r = await executeFn(sql, args);
        return { lastInsertRowid: Number(r.lastInsertRowid ?? 0), changes: r.rowsAffected };
      },
    };
  };
}

const prepare = buildPrepare(async (sql, args) => {
  await ready;
  return client.execute({ sql, args });
});

// Matches better-sqlite3's db.transaction(fn) shape at call sites, with one
// small addition: the callback receives a transaction-scoped `db` (shadow
// the outer name, e.g. `db.transaction((db) => { db.prepare(...).run(...) })`)
// so queries inside actually run on the transaction, not a separate
// connection - and the returned function is now async, so call sites need
// `await apply()` instead of `apply()`.
function transaction(fn) {
  return async (...callArgs) => {
    await ready;
    const tx = await client.transaction("write");
    const scopedDb = { prepare: buildPrepare((sql, args) => tx.execute({ sql, args })) };
    try {
      const result = await fn(scopedDb, ...callArgs);
      await tx.commit();
      return result;
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  };
}

module.exports = { prepare, transaction, ready };
