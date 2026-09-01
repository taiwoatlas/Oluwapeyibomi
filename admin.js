(function(){
"use strict";

const $ = (sel, el) => (el || document).querySelector(sel);
const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

async function api(path, opts) {
  const res = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

/* ---------------- auth / shell ---------------- */

async function checkAuth() {
  try {
    const { authenticated } = await api('/api/admin/me');
    return authenticated;
  } catch { return false; }
}

function showApp() {
  $('#loginScreen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  loadInbox();
}

function showLogin() {
  $('#app').classList.add('hidden');
  $('#loginScreen').classList.remove('hidden');
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#loginError').textContent = '';
  try {
    await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: $('#loginPassword').value }) });
    showApp();
  } catch (err) {
    $('#loginError').textContent = err.message;
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' });
  showLogin();
});

$$('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    $$('.panel').forEach(p => p.classList.add('hidden'));
    $('#tab-' + tab.dataset.tab).classList.remove('hidden');
    if (tab.dataset.tab === 'archive') loadArchive();
    if (tab.dataset.tab === 'instagram') loadInstagram();
  });
});

/* ---------------- inbox ---------------- */

let currentFilter = 'all';
let submissionsCache = [];

async function loadInbox() {
  const { submissions } = await api('/api/admin/submissions');
  submissionsCache = submissions;
  renderInbox();
}

function renderInbox() {
  const list = $('#submissionsList');
  const items = currentFilter === 'all' ? submissionsCache : submissionsCache.filter(s => s.type === currentFilter);
  if (!items.length) {
    list.innerHTML = '<div class="empty-state">Nothing here yet.</div>';
    return;
  }
  list.innerHTML = items.map(renderSubCard).join('');
  $$('.sub-actions [data-action="read"]', list).forEach(btn => {
    btn.addEventListener('click', async () => { await api(`/api/admin/submissions/${btn.dataset.id}/read`, { method: 'POST' }); loadInbox(); });
  });
  $$('.sub-actions [data-action="delete"]', list).forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this submission?')) return;
      await api(`/api/admin/submissions/${btn.dataset.id}`, { method: 'DELETE' });
      loadInbox();
    });
  });
}

function renderSubCard(s) {
  const p = s.payload;
  let body = '';
  if (s.type === 'waitlist') {
    body = `<div><strong>Email</strong>${escapeHtml(p.email)}</div>`;
  } else if (s.type === 'connect') {
    body = `
      <div><strong>Name</strong>${escapeHtml(p.name)}</div>
      <div><strong>Email</strong>${escapeHtml(p.email)}</div>
      ${p.org ? `<div><strong>Org</strong>${escapeHtml(p.org)}</div>` : ''}
      ${p.topics && p.topics.length ? `<div><strong>Topics</strong>${escapeHtml(p.topics.join(', '))}</div>` : ''}
      <div><strong>Message</strong>${escapeHtml(p.message)}</div>`;
  } else if (s.type === 'ask') {
    body = `
      ${p.name ? `<div><strong>Name</strong>${escapeHtml(p.name)}</div>` : ''}
      <div><strong>Email</strong>${escapeHtml(p.email)}</div>
      <div><strong>Question</strong>${escapeHtml(p.question)}</div>`;
  }
  return `<div class="sub-card ${s.read ? '' : 'unread'}">
    <div class="sub-top"><span class="sub-type">${s.type}</span><span class="sub-time">${new Date(s.created_at).toLocaleString()}</span></div>
    <div class="sub-body">${body}</div>
    <div class="sub-actions">
      ${s.read ? '' : `<button data-action="read" data-id="${s.id}">Mark read</button>`}
      <button data-action="delete" data-id="${s.id}">Delete</button>
    </div>
  </div>`;
}

$$('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    $$('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    currentFilter = chip.dataset.type;
    renderInbox();
  });
});

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

/* ---------------- archive ---------------- */

let archiveCache = [];

async function loadArchive() {
  const { items } = await api('/api/archive');
  archiveCache = items;
  const grid = $('#archiveList');
  grid.innerHTML = items.map(item => `
    <div class="archive-card" data-id="${item.id}">
      <img src="/images/thumb/${item.thumbFile}" loading="lazy" alt="">
      <div class="meta">
        <div class="cat">${escapeHtml(item.categoryLabel)}</div>
        ${item.curated ? `<div class="featured-badge">Featured${item.curatedSize ? ' · ' + item.curatedSize : ''}</div>` : ''}
      </div>
    </div>
  `).join('');
  $$('.archive-card', grid).forEach(card => {
    card.addEventListener('click', () => openPhotoModal(archiveCache.find(i => i.id === card.dataset.id)));
  });
}

$('#addPhotoBtn').addEventListener('click', () => openPhotoModal(null));

let editingId = null;
let pendingFull = null;  // { dataUrl }
let pendingThumb = null;

function openPhotoModal(item) {
  editingId = item ? item.id : null;
  $('#modalTitle').textContent = item ? 'Edit photo' : 'Add a photo';
  $('#photoCategory').value = item ? item.category : '';
  $('#photoCategoryLabel').value = item ? item.categoryLabel : '';
  $('#photoCaption').value = item ? item.caption : '';
  $('#photoCurated').checked = item ? item.curated : false;
  $('#photoCuratedSize').value = item ? (item.curatedSize || '') : '';
  $('#curatedSizeRow').classList.toggle('hidden', !$('#photoCurated').checked);
  $('#photoFile').value = '';
  $('#photoPreview').innerHTML = item ? `<img src="/images/thumb/${item.thumbFile}">` : '';
  $('#deletePhotoBtn').classList.toggle('hidden', !item);
  $('#photoFormError').textContent = '';
  pendingFull = null; pendingThumb = null;
  $('#photoModal').classList.remove('hidden');
}

$('#modalClose').addEventListener('click', () => $('#photoModal').classList.add('hidden'));
$('#photoCurated').addEventListener('change', (e) => $('#curatedSizeRow').classList.toggle('hidden', !e.target.checked));

// Resize an image file client-side to a max dimension, return a data URL.
function resizeImage(file, maxDim) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) { height = height * (maxDim / width); width = maxDim; }
        else if (height > maxDim) { width = width * (maxDim / height); height = maxDim; }
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width); canvas.height = Math.round(height);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.85), width: canvas.width, height: canvas.height });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

$('#photoFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const [full, thumb] = await Promise.all([resizeImage(file, 1600), resizeImage(file, 480)]);
  pendingFull = full;
  pendingThumb = thumb;
  $('#photoPreview').innerHTML = `<img src="${full.dataUrl}">`;
});

$('#photoForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#photoFormError').textContent = '';
  const payload = {
    category: $('#photoCategory').value.trim(),
    categoryLabel: $('#photoCategoryLabel').value.trim(),
    caption: $('#photoCaption').value.trim(),
    curated: $('#photoCurated').checked,
    curatedSize: $('#photoCuratedSize').value || null
  };
  try {
    if (editingId) {
      await api(`/api/admin/archive/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      if (!pendingFull) { $('#photoFormError').textContent = 'Choose a photo file first.'; return; }
      payload.imageBase64 = pendingFull.dataUrl;
      payload.thumbBase64 = pendingThumb.dataUrl;
      payload.width = pendingFull.width;
      payload.height = pendingFull.height;
      payload.orientation = pendingFull.width > pendingFull.height ? 'landscape' : (pendingFull.width === pendingFull.height ? 'square' : 'portrait');
      await api('/api/admin/archive', { method: 'POST', body: JSON.stringify(payload) });
    }
    $('#photoModal').classList.add('hidden');
    loadArchive();
  } catch (err) {
    $('#photoFormError').textContent = err.message;
  }
});

$('#deletePhotoBtn').addEventListener('click', async () => {
  if (!editingId || !confirm('Delete this photo? This cannot be undone.')) return;
  await api(`/api/admin/archive/${editingId}`, { method: 'DELETE' });
  $('#photoModal').classList.add('hidden');
  loadArchive();
});

/* ---------------- instagram ---------------- */

async function loadInstagram() {
  const status = $('#igStatus');
  status.textContent = 'Checking connection…';
  status.className = 'ig-status';
  try {
    const cfg = await api('/api/admin/instagram');
    $('#igUserId').value = cfg.userId || '';
    if (cfg.configured) {
      const posts = await api('/api/instagram/posts');
      if (posts.error) {
        status.textContent = `Connected, but the last refresh failed: ${posts.error}`;
        status.className = 'ig-status error';
      } else {
        status.textContent = `Connected — showing ${posts.posts.length} recent post${posts.posts.length === 1 ? '' : 's'}.`;
        status.className = 'ig-status ok';
      }
      renderIgPreview(posts.posts);
    } else {
      status.textContent = 'Not connected yet. Add a User ID and access token below.';
    }
  } catch (err) {
    status.textContent = err.message;
    status.className = 'ig-status error';
  }
}

function renderIgPreview(posts) {
  $('#igPreview').innerHTML = (posts || []).map(p => `
    <a href="${p.permalink}" target="_blank" rel="noopener"><img src="${p.mediaUrl}" loading="lazy" alt=""></a>
  `).join('');
}

$('#igForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = $('#igStatus');
  status.textContent = 'Saving…';
  status.className = 'ig-status';
  try {
    const result = await api('/api/admin/instagram', {
      method: 'POST',
      body: JSON.stringify({ userId: $('#igUserId').value.trim(), token: $('#igToken').value.trim() })
    });
    if (result.error) {
      status.textContent = `Saved, but couldn't fetch posts: ${result.error}`;
      status.className = 'ig-status error';
    } else {
      status.textContent = `Connected — showing ${result.posts.length} recent post${result.posts.length === 1 ? '' : 's'}.`;
      status.className = 'ig-status ok';
      renderIgPreview(result.posts);
    }
  } catch (err) {
    status.textContent = err.message;
    status.className = 'ig-status error';
  }
});

$('#igRefreshBtn').addEventListener('click', async () => {
  const status = $('#igStatus');
  status.textContent = 'Refreshing…';
  try {
    const result = await api('/api/admin/instagram/refresh', { method: 'POST' });
    status.textContent = result.error ? `Refresh failed: ${result.error}` : `Refreshed — showing ${result.posts.length} recent posts.`;
    status.className = result.error ? 'ig-status error' : 'ig-status ok';
    renderIgPreview(result.posts);
  } catch (err) {
    status.textContent = err.message;
    status.className = 'ig-status error';
  }
});

/* ---------------- boot ---------------- */

checkAuth().then(ok => ok ? showApp() : showLogin());
})();
