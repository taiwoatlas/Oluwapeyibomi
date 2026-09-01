const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,              -- 'waitlist' | 'connect' | 'ask'
    payload TEXT NOT NULL,           -- JSON blob of the submitted fields
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    read INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS archive_items (
    id TEXT PRIMARY KEY,             -- slug, e.g. 'softlife-13'
    category TEXT NOT NULL,
    category_label TEXT NOT NULL,
    caption TEXT NOT NULL DEFAULT '',
    orientation TEXT NOT NULL DEFAULT 'portrait',
    width INTEGER,
    height INTEGER,
    full_file TEXT NOT NULL,
    thumb_file TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    curated INTEGER NOT NULL DEFAULT 0,   -- shown in the homepage-of-archive bento grid
    curated_size TEXT,                    -- 'feature' | 'tall' | 'wide' | null
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

module.exports = db;
