/* ============================================================
   MISC CLUB — Admin (content + form submissions management)
   ============================================================ */
const express = require('express');
const crypto  = require('crypto');
const db      = require('./db');

const router  = express.Router();
const COOKIE  = 'misc_club_admin';
const SESSIONS = new Map();

function newToken() { return crypto.randomBytes(24).toString('hex'); }
function setCookie(res, token) {
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/admin; HttpOnly; SameSite=Lax; Max-Age=43200`);
}
function getAdminPassword() { return db.prepare(`SELECT value FROM settings WHERE key='ADMIN_PASSWORD'`).get()?.value || ''; }
function isAuthed(req) {
  const ck = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='));
  if (!ck) return false;
  const token = ck.split('=')[1];
  const exp = SESSIONS.get(token);
  return exp && exp > Date.now();
}
function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  if (req.path.startsWith('/api/') || req.headers.accept?.includes('application/json'))
    return res.status(401).json({ error: 'unauthenticated' });
  return res.redirect('/admin/login');
}

router.get('/login', (_req, res) => res.send(`<!DOCTYPE html><html><head>
<meta charset="UTF-8"/><title>Admin — MISC Club</title><link rel="stylesheet" href="/css/styles.css"/></head>
<body class="login-page"><form method="POST" action="/admin/login" class="form login-form">
<h1>MISC Club Admin</h1><label>Password<input name="password" type="password" required autofocus/></label>
<button class="btn" type="submit">Sign in</button></form></body></html>`));

router.post('/login', express.urlencoded({ extended: true }), (req, res) => {
  const pw = req.body.password || '';
  if (pw !== getAdminPassword()) return res.redirect('/admin/login?bad=1');
  const token = newToken();
  SESSIONS.set(token, Date.now() + 12 * 3600 * 1000);
  setCookie(res, token);
  res.redirect('/admin/');
});

router.post('/logout', (req, res) => {
  const ck = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='));
  if (ck) SESSIONS.delete(ck.split('=')[1]);
  res.json({ ok: true });
});

router.use(requireAuth);

/* ── HTML pages ─────────────────────────────────────────── */
function shell(title, body) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>${title} — MISC Club Admin</title><link rel="stylesheet" href="/css/styles.css"/></head>
<body class="admin">
<header class="admin-header"><div><strong>MISC Club Admin</strong></div>
<nav><a href="/admin/">Dashboard</a><a href="/admin/pages">Pages</a><a href="/admin/posts">News</a><a href="/admin/training">Training</a><a href="/admin/submissions">Submissions</a><a href="/admin/settings">Settings</a>
<button onclick="fetch('/admin/logout',{method:'POST'}).then(()=>location.href='/admin/login')" class="btn-link">Sign out</button></nav></header>
<main>${body}</main></body></html>`;
}

router.get('/', (_req, res) => {
  const counts = {
    pages: db.prepare(`SELECT COUNT(*) AS n FROM pages`).get().n,
    posts: db.prepare(`SELECT COUNT(*) AS n FROM posts`).get().n,
    contact: db.prepare(`SELECT COUNT(*) AS n FROM contact_submissions WHERE status='new'`).get().n,
    join:    db.prepare(`SELECT COUNT(*) AS n FROM membership_applications WHERE status='new'`).get().n,
    training:db.prepare(`SELECT COUNT(*) AS n FROM training_bookings WHERE status='confirmed'`).get().n,
    sessions:db.prepare(`SELECT COUNT(*) AS n FROM training_sessions WHERE session_date >= date('now')`).get().n,
  };
  res.send(shell('Dashboard', `
    <h1>Dashboard</h1>
    <div class="grid">
      <a class="card" href="/admin/pages"><h2>${counts.pages}</h2><p>Pages</p></a>
      <a class="card" href="/admin/posts"><h2>${counts.posts}</h2><p>News posts</p></a>
      <a class="card" href="/admin/submissions?type=contact"><h2>${counts.contact}</h2><p>New contact messages</p></a>
      <a class="card" href="/admin/submissions?type=join"><h2>${counts.join}</h2><p>New membership applications</p></a>
      <a class="card" href="/admin/training"><h2>${counts.training}</h2><p>Confirmed training bookings</p></a>
      <a class="card" href="/admin/training/sessions"><h2>${counts.sessions}</h2><p>Upcoming training sessions</p></a>
    </div>`));
});

/* ── training bookings (admin) ─────────────────────── */
router.get('/training', (_req, res) => {
  const rows = db.prepare(`
    SELECT b.id, b.member_name, b.member_email, b.member_phone, b.experience, b.has_own_kit,
           b.notes, b.status, b.created_at,
           s.session_date, s.discipline, s.start_time
      FROM training_bookings b
      JOIN training_sessions s ON s.id = b.session_id
     ORDER BY s.session_date DESC, s.discipline, b.created_at DESC
     LIMIT 300
  `).all();
  res.send(shell('Training bookings', `
    <h1>Training bookings (${rows.length})</h1>
    <nav class="sub-tabs">
      <a class="active" href="/admin/training">Bookings</a>
      <a href="/admin/training/sessions">Sessions</a>
    </nav>
    <table class="data-table">
      <thead><tr><th>Session</th><th>Discipline</th><th>Member</th><th>Experience</th><th>Own kit</th><th>Status</th><th>Booked</th></tr></thead>
      <tbody>
      ${rows.map(r => `
        <tr>
          <td>${esc(r.session_date)} ${esc(r.start_time)}</td>
          <td>${esc(r.discipline)}</td>
          <td>${esc(r.member_name)}<br><span style="color:#888;font-size:0.78rem">${esc(r.member_email)}${r.member_phone?' · '+esc(r.member_phone):''}</span></td>
          <td>${esc(r.experience||'')}</td>
          <td>${r.has_own_kit?'✓':''}</td>
          <td><code>${esc(r.status)}</code></td>
          <td style="color:#888;font-size:0.78rem">${esc(r.created_at)}</td>
        </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;color:#888;padding:24px">No bookings yet.</td></tr>'}
      </tbody>
    </table>`));
});

router.get('/training/sessions', (_req, res) => {
  const rows = db.prepare(`
    SELECT s.id, s.session_date, s.discipline, s.start_time, s.end_time, s.capacity, s.is_open,
           (SELECT COUNT(*) FROM training_bookings b WHERE b.session_id = s.id AND b.status IN ('confirmed','attended')) AS booked
      FROM training_sessions s
     ORDER BY s.session_date, s.discipline
  `).all();
  res.send(shell('Training sessions', `
    <h1>Training sessions (${rows.length})</h1>
    <nav class="sub-tabs">
      <a href="/admin/training">Bookings</a>
      <a class="active" href="/admin/training/sessions">Sessions</a>
    </nav>
    <table class="data-table">
      <thead><tr><th>Date</th><th>Discipline</th><th>Time</th><th>Capacity</th><th>Booked</th><th>Remaining</th><th>Open</th></tr></thead>
      <tbody>
      ${rows.map(r => `
        <tr>
          <td>${esc(r.session_date)}</td>
          <td>${esc(r.discipline)}</td>
          <td>${esc(r.start_time)} – ${esc(r.end_time)}</td>
          <td>${r.capacity}</td>
          <td>${r.booked}</td>
          <td>${Math.max(0, r.capacity - r.booked)}</td>
          <td>${r.is_open?'✓':'✗'}</td>
        </tr>`).join('')}
      </tbody>
    </table>`));
});

router.get('/pages', (_req, res) => {
  const pages = db.prepare(`SELECT id, slug, title, nav_group, is_published, is_members_only FROM pages ORDER BY nav_group, nav_order, title`).all();
  res.send(shell('Pages', `<h1>Pages (${pages.length})</h1><table class="data-table">
    <thead><tr><th>Title</th><th>Slug</th><th>Group</th><th>Published</th><th>Members-only</th><th></th></tr></thead>
    <tbody>${pages.map(p=>`<tr><td>${esc(p.title)}</td><td><code>${esc(p.slug)}</code></td><td>${esc(p.nav_group||'')}</td><td>${p.is_published?'✓':''}</td><td>${p.is_members_only?'🔒':''}</td><td><a href="/admin/pages/${p.id}">Edit</a> · <a href="/p/${esc(p.slug)}" target="_blank">View</a></td></tr>`).join('')}</tbody></table>`));
});

router.get('/pages/:id', (req, res) => {
  const p = db.prepare(`SELECT * FROM pages WHERE id = ?`).get(req.params.id);
  if (!p) return res.status(404).send('not found');
  res.send(shell('Edit page', `<h1>Edit: ${esc(p.title)}</h1>
    <form method="POST" action="/admin/pages/${p.id}" class="form">
      <label>Title<input name="title" value="${esc(p.title)}" required/></label>
      <label>Slug<input name="slug" value="${esc(p.slug)}" required/></label>
      <div class="row">
        <label>Nav group<input name="nav_group" value="${esc(p.nav_group||'')}" placeholder="about, disciplines, how-to, members, contact"/></label>
        <label>Nav order<input name="nav_order" type="number" value="${p.nav_order}"/></label>
      </div>
      <div class="row">
        <label><input type="checkbox" name="is_published" value="1" ${p.is_published?'checked':''}/> Published</label>
        <label><input type="checkbox" name="is_members_only" value="1" ${p.is_members_only?'checked':''}/> Members only</label>
      </div>
      <label>Body (HTML)<textarea name="body_html" rows="20">${esc(p.body_html)}</textarea></label>
      <button class="btn" type="submit">Save</button> <a href="/admin/pages">Cancel</a>
    </form>
    <hr/><p style="color:#888">Source: ${p.source_url ? '<a href="'+esc(p.source_url)+'" target="_blank">'+esc(p.source_url)+'</a>' : '(none)'}</p>`));
});

router.post('/pages/:id', express.urlencoded({ extended: true, limit: '5mb' }), (req, res) => {
  const f = req.body;
  db.prepare(`UPDATE pages SET title=?, slug=?, nav_group=?, nav_order=?, is_published=?, is_members_only=?, body_html=?, body_text=?, updated_at=datetime('now') WHERE id=?`)
    .run(f.title, f.slug.toLowerCase(), f.nav_group||null, parseInt(f.nav_order||100,10), f.is_published?1:0, f.is_members_only?1:0,
         f.body_html||'', stripTags(f.body_html||''), req.params.id);
  res.redirect('/admin/pages');
});

router.get('/posts', (_req, res) => {
  const posts = db.prepare(`SELECT id, slug, title, published_at, is_published FROM posts ORDER BY published_at DESC, id DESC`).all();
  res.send(shell('News posts', `<h1>News posts (${posts.length})</h1><table class="data-table">
    <thead><tr><th>Title</th><th>Slug</th><th>Date</th><th>Published</th><th></th></tr></thead>
    <tbody>${posts.map(p=>`<tr><td>${esc(p.title)}</td><td><code>${esc(p.slug)}</code></td><td>${esc(p.published_at||'')}</td><td>${p.is_published?'✓':''}</td><td><a href="/news/${esc(p.slug)}" target="_blank">View</a></td></tr>`).join('')}</tbody></table>`));
});

router.get('/submissions', (req, res) => {
  const type = String(req.query.type || 'contact');
  const tableMap = { contact:'contact_submissions', join:'membership_applications' };
  const t = tableMap[type] || tableMap.contact;
  const rows = db.prepare(`SELECT * FROM ${t} ORDER BY created_at DESC LIMIT 200`).all();
  const cols = rows.length ? Object.keys(rows[0]) : [];
  res.send(shell('Submissions', `<h1>${type}: ${rows.length} submissions</h1>
    <nav class="sub-tabs">
      <a class="${type==='contact'?'active':''}" href="?type=contact">Contact</a>
      <a class="${type==='join'?'active':''}" href="?type=join">Membership</a>
      <a href="/admin/training">Training bookings →</a>
    </nav>
    <table class="data-table">
      <thead><tr>${cols.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r=>`<tr>${cols.map(c=>`<td>${esc(String(r[c]??'')).slice(0,300)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`));
});

router.get('/settings', (_req, res) => {
  const settings = db.prepare(`SELECT key, value FROM settings ORDER BY key`).all();
  res.send(shell('Settings', `<h1>Settings</h1>
    <form method="POST" action="/admin/settings" class="form">
      ${settings.map(s=>`<label>${esc(s.key)}<input name="${esc(s.key)}" value="${esc(s.value)}" type="${/PASSWORD|PASS$/.test(s.key)?'password':'text'}"/></label>`).join('')}
      <button class="btn" type="submit">Save</button>
    </form>`));
});

router.post('/settings', express.urlencoded({ extended: true }), (req, res) => {
  const stmt = db.prepare(`INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
  const tx = db.transaction(() => { Object.entries(req.body).forEach(([k,v])=>stmt.run(k, String(v))); });
  tx();
  res.redirect('/admin/settings');
});

function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function stripTags(html) { return String(html).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(); }

module.exports = router;
