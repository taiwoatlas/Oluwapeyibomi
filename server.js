const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const { loadEnv } = require('./lib/env');
loadEnv();

const db = require('./lib/db');
const { seedIfEmpty } = require('./lib/seed');
const auth = require('./lib/auth');
const instagram = require('./lib/instagram');
const { sendNotification } = require('./lib/notify');

const PORT = Number(process.env.PORT || 3000);
const SITE_DIR = path.resolve(__dirname, process.env.SITE_DIR || '../oluwapeyibomi-website');
const ADMIN_DIR = path.join(__dirname, 'public', 'admin');
const MAX_BODY_BYTES = 15 * 1024 * 1024; // 15MB — enough for two base64-encoded photos

seedIfEmpty(SITE_DIR);

/* ---------------- tiny helpers ---------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

// Prevents path traversal outside a given root directory.
function safeJoin(root, requestPath) {
  const decoded = decodeURIComponent(requestPath);
  const resolved = path.normalize(path.join(root, decoded));
  if (!resolved.startsWith(path.normalize(root))) return null;
  return resolved;
}

function readJSONBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(Object.assign(new Error('Invalid JSON body'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function setSessionCookie(res, token, expiresAt) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `admin_session=${token}; HttpOnly; SameSite=Lax; Path=/; Expires=${new Date(expiresAt).toUTCString()}${secure}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'admin_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

// Decodes a data URL ("data:image/jpeg;base64,...") into a Buffer + extension.
function decodeDataUrl(dataUrl) {
  const match = /^data:image\/(\w+);base64,(.+)$/.exec(dataUrl || '');
  if (!match) return null;
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  return { buffer: Buffer.from(match[2], 'base64'), ext };
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/* ---------------- route handlers ---------------- */

const routes = [];
function route(method, pattern, handler) {
  // pattern like '/api/admin/archive/:id' -> regex with named group
  const paramNames = [];
  const regexStr = pattern.replace(/:([a-zA-Z]+)/g, (_, name) => {
    paramNames.push(name);
    return '([^/]+)';
  });
  const regex = new RegExp(`^${regexStr}$`);
  routes.push({ method, regex, paramNames, handler });
}

async function handleApi(req, res, pathname) {
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.regex.exec(pathname);
    if (!m) continue;
    const params = {};
    r.paramNames.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]); });
    try {
      await r.handler(req, res, params);
    } catch (err) {
      const status = err.statusCode || 500;
      sendJSON(res, status, { error: err.message || 'Server error' });
    }
    return true;
  }
  return false;
}

/* ---- forms ---- */

function saveSubmission(type, payload) {
  const info = db.prepare('INSERT INTO submissions (type, payload) VALUES (?, ?)').run(type, JSON.stringify(payload));
  return info.lastInsertRowid;
}

route('POST', '/api/waitlist', async (req, res) => {
  const body = await readJSONBody(req);
  if (!isValidEmail(body.email)) return sendJSON(res, 400, { error: 'A valid email is required.' });
  saveSubmission('waitlist', { email: body.email });
  await sendNotification({
    subject: 'New waitlist signup — Oluwapeyibomi',
    text: `New signup: ${body.email}`
  });
  sendJSON(res, 200, { ok: true });
});

route('POST', '/api/connect', async (req, res) => {
  const body = await readJSONBody(req);
  const { name, email, org, topics, message } = body;
  if (!name || !isValidEmail(email) || !message) {
    return sendJSON(res, 400, { error: 'Name, a valid email, and a message are required.' });
  }
  const payload = {
    name: String(name).slice(0, 200),
    email,
    org: org ? String(org).slice(0, 200) : '',
    topics: Array.isArray(topics) ? topics.slice(0, 10) : [],
    message: String(message).slice(0, 5000)
  };
  saveSubmission('connect', payload);
  await sendNotification({
    subject: `New enquiry from ${payload.name} — Oluwapeyibomi`,
    text: `Name: ${payload.name}\nEmail: ${payload.email}\nOrg: ${payload.org}\nTopics: ${payload.topics.join(', ')}\n\n${payload.message}`
  });
  sendJSON(res, 200, { ok: true });
});

route('POST', '/api/ask', async (req, res) => {
  const body = await readJSONBody(req);
  const { name, email, question } = body;
  if (!isValidEmail(email) || !question) {
    return sendJSON(res, 400, { error: 'A valid email and a question are required.' });
  }
  const payload = {
    name: name ? String(name).slice(0, 200) : '',
    email,
    question: String(question).slice(0, 3000)
  };
  saveSubmission('ask', payload);
  await sendNotification({
    subject: `New question from ${payload.name || 'a visitor'} — Oluwapeyibomi`,
    text: `From: ${payload.name || '(no name)'} <${payload.email}>\n\n${payload.question}`
  });
  sendJSON(res, 200, { ok: true });
});

/* ---- admin auth ---- */

route('POST', '/api/admin/login', async (req, res) => {
  const body = await readJSONBody(req);
  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (!hash) {
    return sendJSON(res, 500, { error: 'Admin login is not configured yet. Set ADMIN_PASSWORD_HASH in .env (see README).' });
  }
  if (!body.password || !auth.verifyPassword(body.password, hash)) {
    return sendJSON(res, 401, { error: 'Incorrect password.' });
  }
  const { token, expiresAt } = auth.createSession();
  setSessionCookie(res, token, expiresAt);
  sendJSON(res, 200, { ok: true });
});

route('POST', '/api/admin/logout', async (req, res) => {
  const cookies = auth.parseCookies(req);
  auth.destroySession(cookies.admin_session);
  clearSessionCookie(res);
  sendJSON(res, 200, { ok: true });
});

route('GET', '/api/admin/me', async (req, res) => {
  const cookies = auth.parseCookies(req);
  sendJSON(res, 200, { authenticated: auth.isSessionValid(cookies.admin_session) });
});

/* ---- admin: submissions ---- */

route('GET', '/api/admin/submissions', async (req, res) => {
  if (!auth.requireAdmin(req, res)) return;
  const rows = db.prepare('SELECT * FROM submissions ORDER BY created_at DESC').all();
  const parsed = rows.map(r => ({ ...r, payload: JSON.parse(r.payload) }));
  sendJSON(res, 200, { submissions: parsed });
});

route('POST', '/api/admin/submissions/:id/read', async (req, res, params) => {
  if (!auth.requireAdmin(req, res)) return;
  db.prepare('UPDATE submissions SET read = 1 WHERE id = ?').run(params.id);
  sendJSON(res, 200, { ok: true });
});

route('DELETE', '/api/admin/submissions/:id', async (req, res, params) => {
  if (!auth.requireAdmin(req, res)) return;
  db.prepare('DELETE FROM submissions WHERE id = ?').run(params.id);
  sendJSON(res, 200, { ok: true });
});

/* ---- archive (public read, admin write) ---- */

function rowToItem(row) {
  return {
    id: row.id,
    category: row.category,
    categoryLabel: row.category_label,
    caption: row.caption,
    orientation: row.orientation,
    w: row.width,
    h: row.height,
    file: row.full_file,
    thumbFile: row.thumb_file,
    sortOrder: row.sort_order,
    curated: !!row.curated,
    curatedSize: row.curated_size
  };
}

route('GET', '/api/archive', async (req, res) => {
  const rows = db.prepare('SELECT * FROM archive_items ORDER BY sort_order ASC').all();
  sendJSON(res, 200, { items: rows.map(rowToItem) });
});

route('POST', '/api/admin/archive', async (req, res) => {
  if (!auth.requireAdmin(req, res)) return;
  const body = await readJSONBody(req);
  const { category, categoryLabel, caption, orientation, imageBase64, thumbBase64, curated, curatedSize } = body;
  if (!category || !categoryLabel || !imageBase64) {
    return sendJSON(res, 400, { error: 'category, categoryLabel, and imageBase64 are required.' });
  }
  const full = decodeDataUrl(imageBase64);
  if (!full) return sendJSON(res, 400, { error: 'imageBase64 must be a data:image/... URL.' });
  const thumb = decodeDataUrl(thumbBase64) || full;

  const id = `${category}-${crypto.randomBytes(4).toString('hex')}`;
  const fullFile = `${id}.${full.ext}`;
  const thumbFile = `${id}-thumb.${thumb.ext}`;

  fs.writeFileSync(path.join(SITE_DIR, 'images', 'full', fullFile), full.buffer);
  fs.writeFileSync(path.join(SITE_DIR, 'images', 'thumb', thumbFile), thumb.buffer);

  const maxOrder = db.prepare('SELECT MAX(sort_order) AS m FROM archive_items').get().m || 0;

  db.prepare(`
    INSERT INTO archive_items
      (id, category, category_label, caption, orientation, width, height, full_file, thumb_file, sort_order, curated, curated_size)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, category, categoryLabel, caption || '', orientation || 'portrait',
    body.width || null, body.height || null, fullFile, thumbFile,
    maxOrder + 1, curated ? 1 : 0, curatedSize || null
  );

  sendJSON(res, 201, { item: rowToItem(db.prepare('SELECT * FROM archive_items WHERE id = ?').get(id)) });
});

route('PUT', '/api/admin/archive/:id', async (req, res, params) => {
  if (!auth.requireAdmin(req, res)) return;
  const existing = db.prepare('SELECT * FROM archive_items WHERE id = ?').get(params.id);
  if (!existing) return sendJSON(res, 404, { error: 'Not found.' });
  const body = await readJSONBody(req);

  const next = {
    category: body.category ?? existing.category,
    category_label: body.categoryLabel ?? existing.category_label,
    caption: body.caption ?? existing.caption,
    orientation: body.orientation ?? existing.orientation,
    sort_order: body.sortOrder ?? existing.sort_order,
    curated: body.curated === undefined ? existing.curated : (body.curated ? 1 : 0),
    curated_size: body.curatedSize === undefined ? existing.curated_size : body.curatedSize
  };

  db.prepare(`
    UPDATE archive_items SET category=?, category_label=?, caption=?, orientation=?, sort_order=?, curated=?, curated_size=?
    WHERE id=?
  `).run(next.category, next.category_label, next.caption, next.orientation, next.sort_order, next.curated, next.curated_size, params.id);

  sendJSON(res, 200, { item: rowToItem(db.prepare('SELECT * FROM archive_items WHERE id = ?').get(params.id)) });
});

route('DELETE', '/api/admin/archive/:id', async (req, res, params) => {
  if (!auth.requireAdmin(req, res)) return;
  const existing = db.prepare('SELECT * FROM archive_items WHERE id = ?').get(params.id);
  if (!existing) return sendJSON(res, 404, { error: 'Not found.' });
  db.prepare('DELETE FROM archive_items WHERE id = ?').run(params.id);
  [existing.full_file, existing.thumb_file].forEach(file => {
    ['full', 'thumb'].forEach(dir => {
      const p = path.join(SITE_DIR, 'images', dir, file);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    });
  });
  sendJSON(res, 200, { ok: true });
});

/* ---- instagram ---- */

route('GET', '/api/instagram/posts', async (req, res) => {
  const result = await instagram.getPosts();
  sendJSON(res, 200, result);
});

route('GET', '/api/admin/instagram', async (req, res) => {
  if (!auth.requireAdmin(req, res)) return;
  const { token, userId } = instagram.getConfig();
  sendJSON(res, 200, { configured: !!(token && userId), userId, hasToken: !!token });
});

route('POST', '/api/admin/instagram', async (req, res) => {
  if (!auth.requireAdmin(req, res)) return;
  const body = await readJSONBody(req);
  instagram.saveConfig({ token: body.token, userId: body.userId });
  const result = await instagram.getPosts({ forceRefresh: true });
  sendJSON(res, 200, result);
});

route('POST', '/api/admin/instagram/refresh', async (req, res) => {
  if (!auth.requireAdmin(req, res)) return;
  const result = await instagram.getPosts({ forceRefresh: true });
  sendJSON(res, 200, result);
});

/* ---------------- static file serving ---------------- */

function serveStatic(req, res, pathname) {
  let root = SITE_DIR;
  let reqPath = pathname;

  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    root = ADMIN_DIR;
    reqPath = pathname.replace(/^\/admin/, '') || '/';
  }

  if (reqPath === '/') reqPath = '/index.html';
  let filePath = safeJoin(root, reqPath);
  if (!filePath) {
    res.writeHead(400); res.end('Bad request'); return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // SPA-style fallback for the admin panel; 404 page for the site if present
    if (root === ADMIN_DIR) {
      filePath = path.join(ADMIN_DIR, 'index.html');
    } else {
      const notFound = path.join(SITE_DIR, '404.html');
      filePath = fs.existsSync(notFound) ? notFound : path.join(SITE_DIR, 'index.html');
    }
  }
  sendFile(res, filePath);
}

/* ---------------- server ---------------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname.startsWith('/api/')) {
    const handled = await handleApi(req, res, pathname);
    if (!handled) sendJSON(res, 404, { error: 'Unknown API route.' });
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`\nOluwapeyibomi backend running at http://localhost:${PORT}`);
  console.log(`  Site:  http://localhost:${PORT}/`);
  console.log(`  Admin: http://localhost:${PORT}/admin/`);
  if (!process.env.ADMIN_PASSWORD_HASH) {
    console.log(`\n⚠ ADMIN_PASSWORD_HASH is not set — run "npm run hash-password" and add it to .env.`);
  }
});
