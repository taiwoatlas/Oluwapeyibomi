const db = require('./db');

const CACHE_KEY = 'instagram_posts_cache';
const CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour — Instagram doesn't need second-by-second polling

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

function getConfig() {
  return {
    token: getSetting('ig_access_token') || process.env.IG_ACCESS_TOKEN || '',
    userId: getSetting('ig_user_id') || process.env.IG_USER_ID || ''
  };
}

function saveConfig({ token, userId }) {
  if (token !== undefined) setSetting('ig_access_token', token);
  if (userId !== undefined) setSetting('ig_user_id', userId);
  // config changed — invalidate cache so the next request refetches
  setSetting(CACHE_KEY, JSON.stringify({ fetchedAt: 0, posts: [] }));
}

async function fetchFromGraphAPI({ token, userId }) {
  const fields = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp';
  const url = `https://graph.instagram.com/${encodeURIComponent(userId)}/media?fields=${fields}&access_token=${encodeURIComponent(token)}&limit=12`;
  const resp = await fetch(url);
  const json = await resp.json();
  if (!resp.ok) {
    const message = json?.error?.message || `Instagram API returned ${resp.status}`;
    throw new Error(message);
  }
  return (json.data || []).map(post => ({
    id: post.id,
    caption: post.caption || '',
    mediaType: post.media_type,
    mediaUrl: post.media_type === 'VIDEO' ? (post.thumbnail_url || post.media_url) : post.media_url,
    permalink: post.permalink,
    timestamp: post.timestamp
  }));
}

// Returns { configured, posts, error, fetchedAt }
async function getPosts({ forceRefresh = false } = {}) {
  const { token, userId } = getConfig();
  if (!token || !userId) {
    return { configured: false, posts: [], error: null, fetchedAt: null };
  }

  const cachedRaw = getSetting(CACHE_KEY);
  const cached = cachedRaw ? JSON.parse(cachedRaw) : { fetchedAt: 0, posts: [] };
  const isFresh = Date.now() - cached.fetchedAt < CACHE_TTL_MS;

  if (isFresh && !forceRefresh && cached.posts.length) {
    return { configured: true, posts: cached.posts, error: null, fetchedAt: cached.fetchedAt };
  }

  try {
    const posts = await fetchFromGraphAPI({ token, userId });
    const fetchedAt = Date.now();
    setSetting(CACHE_KEY, JSON.stringify({ fetchedAt, posts }));
    return { configured: true, posts, error: null, fetchedAt };
  } catch (err) {
    // Serve stale cache on failure rather than showing nothing
    return {
      configured: true,
      posts: cached.posts || [],
      error: err.message,
      fetchedAt: cached.fetchedAt || null
    };
  }
}

module.exports = { getPosts, getConfig, saveConfig };
