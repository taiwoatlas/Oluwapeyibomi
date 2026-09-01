const fs = require('fs');
const path = require('path');
const db = require('./db');

// The 9 hand-picked photos currently shown in the archive's bento grid,
// carried over from the static site so nothing changes on first boot.
const CURATED = {
  'cameraroll-01': 'feature',
  'transition-02': 'tall',
  'july-05': null,
  'life20s-02': null,
  'career-06': 'wide',
  'softlife-02': null,
  'vlogs-03': null,
  'softlife-09': null,
  'cameraroll-09': null
};

function seedIfEmpty(siteDir) {
  const countRow = db.prepare('SELECT COUNT(*) AS n FROM archive_items').get();
  if (countRow.n > 0) return; // already seeded

  const manifestPath = path.join(siteDir, 'images', 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.warn('[seed] No images/manifest.json found at', manifestPath, '— skipping seed.');
    return;
  }
  const items = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const insert = db.prepare(`
    INSERT INTO archive_items
      (id, category, category_label, caption, orientation, width, height, full_file, thumb_file, sort_order, curated, curated_size)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec('BEGIN');
  try {
    items.forEach((item, i) => {
      const curated = Object.prototype.hasOwnProperty.call(CURATED, item.id) ? 1 : 0;
      const size = CURATED[item.id] || null;
      insert.run(
        item.id,
        item.category,
        item.categoryLabel,
        item.caption || '',
        item.orientation || 'portrait',
        item.w || null,
        item.h || null,
        item.file,
        item.file,
        i,
        curated,
        size
      );
    });
    db.exec('COMMIT');
    console.log(`[seed] Imported ${items.length} archive items (${Object.keys(CURATED).length} curated).`);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { seedIfEmpty };
