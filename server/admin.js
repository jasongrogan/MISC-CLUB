/* ============================================================
   MISC CLUB — Admin (content + form submissions management)
   ============================================================ */
const express = require('express');
const crypto  = require('crypto');
const path    = require('path');
const fs      = require('fs');
const db      = require('./db');
const auth    = require('./auth');
const sp      = require('./sight-picture');

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
<nav><a href="/admin/">Dashboard</a><a href="/admin/pages">Pages</a><a href="/admin/posts">News</a><a href="/admin/events">Events</a><a href="/admin/training">Training</a><a href="/admin/members">Members</a><a href="/admin/documents">Documents</a><a href="/admin/submissions">Submissions</a><a href="/admin/settings">Settings</a>
<button onclick="fetch('/admin/logout',{method:'POST'}).then(()=>location.href='/admin/login')" class="btn-link">Sign out</button></nav></header>
<main>${body}</main></body></html>`;
}

router.get('/', (_req, res) => {
  const counts = {
    pages:    db.prepare(`SELECT COUNT(*) AS n FROM pages`).get().n,
    posts:    db.prepare(`SELECT COUNT(*) AS n FROM posts`).get().n,
    events:   db.prepare(`SELECT COUNT(*) AS n FROM events WHERE event_date >= date('now') AND is_published=1`).get().n,
    members:  db.prepare(`SELECT COUNT(*) AS n FROM members WHERE is_active=1`).get().n,
    documents:db.prepare(`SELECT COUNT(*) AS n FROM documents`).get().n,
    contact:  db.prepare(`SELECT COUNT(*) AS n FROM contact_submissions WHERE status='new'`).get().n,
    join:     db.prepare(`SELECT COUNT(*) AS n FROM membership_applications WHERE status='new'`).get().n,
    training: db.prepare(`SELECT COUNT(*) AS n FROM training_bookings WHERE status='confirmed'`).get().n,
    sessions: db.prepare(`SELECT COUNT(*) AS n FROM training_sessions WHERE session_date >= date('now')`).get().n,
  };
  res.send(shell('Dashboard', `
    <h1>Dashboard</h1>
    <div class="grid">
      <a class="card" href="/admin/pages"><h2>${counts.pages}</h2><p>Pages</p></a>
      <a class="card" href="/admin/posts"><h2>${counts.posts}</h2><p>News posts</p></a>
      <a class="card" href="/admin/events"><h2>${counts.events}</h2><p>Upcoming events</p></a>
      <a class="card" href="/admin/members"><h2>${counts.members}</h2><p>Members</p></a>
      <a class="card" href="/admin/documents"><h2>${counts.documents}</h2><p>Documents</p></a>
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

/* ── Events CRUD ─────────────────────────────────────── */
const CATS = ['competition','club','training','social','external'];

router.get('/events', (_req, res) => {
  const rows = db.prepare(`SELECT * FROM events ORDER BY event_date, start_time`).all();
  res.send(shell('Events', `
    <h1>Club Calendar Events (${rows.length})</h1>
    <p style="margin-bottom:20px"><a href="/admin/events/new" class="btn btn-sm" style="background:var(--gold);color:#111;border:none">+ New event</a>
    &nbsp;<a href="/calendar" target="_blank" style="color:var(--muted);font-size:.85rem">View public calendar ↗</a></p>
    <table class="data-table">
      <thead><tr><th>Date</th><th>Title</th><th>Category</th><th>Time</th><th>Published</th><th></th></tr></thead>
      <tbody>
      ${rows.map(r=>`<tr>
        <td>${esc(r.event_date)}${r.end_date&&r.end_date!==r.event_date?' → '+esc(r.end_date):''}</td>
        <td>${esc(r.title)}</td>
        <td><code>${esc(r.category)}</code></td>
        <td>${esc(r.start_time||'')}${r.end_time?' – '+esc(r.end_time):''}</td>
        <td>${r.is_published?'✓':''}</td>
        <td><a href="/admin/events/${r.id}">Edit</a></td>
      </tr>`).join('')}
      </tbody>
    </table>`));
});

function eventForm(ev, action) {
  const v = f => esc(ev?.[f] ?? '');
  const checked = (f, val) => (ev?.[f] ?? '') === val ? 'selected' : '';
  return `<form method="POST" action="${action}" class="form">
    <label>Title *<input name="title" value="${v('title')}" required maxlength="200"/></label>
    <div class="row">
      <label>Start date *<input name="event_date" type="date" value="${v('event_date')}" required/></label>
      <label>End date (multi-day)<input name="end_date" type="date" value="${v('end_date')}"/></label>
    </div>
    <div class="row">
      <label>Start time<input name="start_time" type="time" value="${v('start_time')}"/></label>
      <label>End time<input name="end_time" type="time" value="${v('end_time')}"/></label>
    </div>
    <label>Category
      <select name="category">
        ${CATS.map(c=>`<option value="${c}" ${checked('category',c)||(!ev?.category&&c==='club'?'selected':'')}>${c}</option>`).join('')}
      </select>
    </label>
    <label>Description<textarea name="description" rows="4" maxlength="2000">${v('description')}</textarea></label>
    <label>Location<input name="location" value="${v('location')||'120–128 Todd Road, Port Melbourne'}" maxlength="200"/></label>
    <label>External URL<input name="external_url" type="url" value="${v('external_url')}" maxlength="400" placeholder="https://..."/></label>
    <label><input type="checkbox" name="is_published" value="1" ${ev==null||ev.is_published?'checked':''}/> Published</label>
    <button class="btn" type="submit">Save event</button>
    <a href="/admin/events" style="margin-left:12px">Cancel</a>
  </form>`;
}

router.get('/events/new', (_req, res) => {
  res.send(shell('New event', `<h1>New event</h1>${eventForm(null, '/admin/events')}`));
});

router.post('/events', express.urlencoded({ extended: true }), (req, res) => {
  const f = req.body;
  if (!f.title || !f.event_date) return res.redirect('/admin/events/new');
  db.prepare(`INSERT INTO events (title,event_date,end_date,start_time,end_time,category,description,location,external_url,is_published)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(f.title, f.event_date, f.end_date||null, f.start_time||null, f.end_time||null,
         f.category||'club', f.description||null, f.location||null, f.external_url||null, f.is_published?1:0);
  res.redirect('/admin/events');
});

router.get('/events/:id', (req, res) => {
  const ev = db.prepare(`SELECT * FROM events WHERE id=?`).get(req.params.id);
  if (!ev) return res.status(404).send('not found');
  res.send(shell('Edit event', `
    <h1>Edit: ${esc(ev.title)}</h1>
    ${eventForm(ev, `/admin/events/${ev.id}`)}
    <hr style="margin-top:32px"/>
    <form method="POST" action="/admin/events/${ev.id}/delete" onsubmit="return confirm('Delete this event?')">
      <button type="submit" style="background:var(--crimson);color:#fff;border:none;padding:10px 20px;border-radius:2px;cursor:pointer">Delete event</button>
    </form>`));
});

router.post('/events/:id', express.urlencoded({ extended: true }), (req, res) => {
  const f = req.body;
  db.prepare(`UPDATE events SET title=?,event_date=?,end_date=?,start_time=?,end_time=?,category=?,description=?,location=?,external_url=?,is_published=? WHERE id=?`)
    .run(f.title, f.event_date, f.end_date||null, f.start_time||null, f.end_time||null,
         f.category||'club', f.description||null, f.location||null, f.external_url||null, f.is_published?1:0,
         req.params.id);
  res.redirect('/admin/events');
});

router.post('/events/:id/delete', (req, res) => {
  db.prepare(`DELETE FROM events WHERE id=?`).run(req.params.id);
  res.redirect('/admin/events');
});

/* ── Members admin (browse, sync, reset password, view detail) ─────── */
router.get('/members', (req, res) => {
  const q = String(req.query.q || '').trim();
  let rows;
  if (q) {
    const like = `%${q.toLowerCase()}%`;
    rows = db.prepare(`SELECT * FROM members WHERE
        LOWER(member_number) LIKE ? OR LOWER(display_name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(pistol_licence) LIKE ?
      ORDER BY display_name LIMIT 500`).all(like, like, like, like);
  } else {
    rows = db.prepare(`SELECT * FROM members ORDER BY display_name LIMIT 500`).all();
  }
  const total = db.prepare(`SELECT COUNT(*) AS n FROM members`).get().n;
  res.send(shell('Members', `
    <h1>Members <small style="color:#888">(${rows.length} shown of ${total} total)</small></h1>
    <form method="POST" action="/admin/members/sync" style="display:inline">
      <button class="btn btn-sm" style="background:var(--gold);color:#111;border:none;padding:8px 16px;border-radius:2px;cursor:pointer">↻ Sync all from Sight Picture</button>
    </form>
    <form method="GET" action="/admin/members" style="display:inline-block;margin-left:14px">
      <input name="q" placeholder="Search name, member #, email, licence…" value="${esc(q)}" style="padding:6px 10px;width:280px"/>
      <button type="submit" class="btn btn-sm">Search</button>
    </form>
    <p style="color:#888;font-size:0.85rem;margin-top:14px">Sync pulls all MISC members from Sight Picture and creates accounts with the temp password <code>{memberNumber}temp1!</code>. Existing rows are updated but passwords are never overwritten.</p>
    <table class="data-table" style="margin-top:20px">
      <thead><tr><th>#</th><th>Name</th><th>Email</th><th>Pistol licence</th><th>VAPA</th><th>TRV</th><th>Last login</th><th></th></tr></thead>
      <tbody>
      ${rows.map(r => `<tr>
        <td><code>${esc(r.member_number)}</code></td>
        <td>${esc(r.display_name)}</td>
        <td>${esc(r.email||'')}</td>
        <td>${esc(r.pistol_licence||'')}</td>
        <td>${esc(r.vapa_id||'')}</td>
        <td>${esc(r.trv_id||'')}</td>
        <td><span style="color:#888;font-size:0.78rem">${esc(r.last_login||'—')}</span></td>
        <td><a href="/admin/members/${r.id}">View</a></td>
      </tr>`).join('') || '<tr><td colspan="8" style="text-align:center;color:#888;padding:32px">No members. Click "Sync all from Sight Picture" to import.</td></tr>'}
      </tbody>
    </table>
  `));
});

router.post('/members/sync', async (req, res) => {
  try {
    const remote = await sp.listMembers();
    if (!Array.isArray(remote)) throw new Error('Unexpected response from Sight Picture');
    const upsert = db.prepare(`
      INSERT INTO members (member_number, display_name, first_name, last_name, email, sp_user_id, sp_access_roles, pistol_licence, password_hash, password_salt, must_change_password, sp_synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
      ON CONFLICT(member_number) DO UPDATE SET
        display_name = excluded.display_name,
        email = excluded.email,
        sp_user_id = excluded.sp_user_id,
        sp_access_roles = excluded.sp_access_roles,
        pistol_licence = COALESCE(NULLIF(members.pistol_licence,''), excluded.pistol_licence),
        sp_synced_at = datetime('now'),
        updated_at = datetime('now')
    `);
    let inserted = 0, updated = 0;
    const tx = db.transaction(() => {
      for (const r of remote) {
        const num = String(r.memberId || '').trim();
        if (!num) continue;
        const existing = db.prepare(`SELECT id FROM members WHERE member_number = ?`).get(num);
        let hash = null, salt = null;
        if (!existing) {
          const h = auth.hashPassword(auth.defaultPasswordFor(num));
          hash = h.hash; salt = h.salt;
        }
        const parts = String(r.name || '').trim().split(/\s+/);
        const first = parts.length > 1 ? parts[0] : (parts[0] || '');
        const last  = parts.length > 1 ? parts.slice(1).join(' ') : '';
        upsert.run(
          num,
          r.name || `Member ${num}`,
          first || null, last || null,
          (r.email || '').trim() || null,
          r.userId || null,
          JSON.stringify(r.access || []),
          (r.licence || '').trim() || null,
          hash, salt,
        );
        if (existing) updated++; else inserted++;
      }
    });
    tx();
    res.redirect(`/admin/members?msg=Synced+${inserted}+new%2C+${updated}+updated`);
  } catch (err) {
    console.error('[admin] member sync failed', err);
    res.redirect(`/admin/members?err=${encodeURIComponent(err.message.slice(0,160))}`);
  }
});

router.get('/members/:id', (req, res) => {
  const m = db.prepare(`SELECT * FROM members WHERE id = ?`).get(req.params.id);
  if (!m) return res.status(404).send('not found');
  const scoreCount = db.prepare(`SELECT COUNT(*) AS n FROM member_scores WHERE member_id=?`).get(m.id).n;
  const lastScore  = db.prepare(`SELECT * FROM member_scores WHERE member_id=? ORDER BY match_date DESC LIMIT 1`).get(m.id);
  res.send(shell('Member detail', `
    <h1>${esc(m.display_name)} <small style="color:#888">#${esc(m.member_number)}</small></h1>
    <p><a href="/admin/members">← Back to members</a></p>

    <form method="POST" action="/admin/members/${m.id}" class="form" style="max-width:720px">
      <div class="row"><label>Email<input name="email" value="${esc(m.email||'')}"/></label>
        <label>Member status<select name="is_active"><option value="1" ${m.is_active?'selected':''}>Active</option><option value="0" ${!m.is_active?'selected':''}>Inactive</option></select></label></div>
      <div class="row"><label>VAPA ID<input name="vapa_id" value="${esc(m.vapa_id||'')}"/></label>
        <label>TRV ID<input name="trv_id" value="${esc(m.trv_id||'')}"/></label></div>
      <div class="row"><label>Pistol licence<input name="pistol_licence" value="${esc(m.pistol_licence||'')}"/></label>
        <label>Expiry<input name="pistol_licence_expiry" type="date" value="${esc(m.pistol_licence_expiry||'')}"/></label></div>
      <div class="row"><label>Long-arm licence<input name="rifle_licence" value="${esc(m.rifle_licence||'')}"/></label>
        <label>Expiry<input name="rifle_licence_expiry" type="date" value="${esc(m.rifle_licence_expiry||'')}"/></label></div>
      <button class="btn" type="submit">Save changes</button>
    </form>

    <hr style="margin:28px 0"/>
    <h3>Sight Picture sync</h3>
    <p><strong>Roles:</strong> <code>${esc(m.sp_access_roles||'[]')}</code><br>
       <strong>SP userId:</strong> <code>${esc(m.sp_user_id||'')}</code><br>
       <strong>Last SP sync:</strong> ${esc(m.sp_synced_at||'never')}</p>
    <form method="POST" action="/admin/members/${m.id}/scores-sync" style="display:inline">
      <button class="btn btn-sm" type="submit">↻ Sync ${esc(m.display_name)}'s scores</button>
    </form>

    <h3 style="margin-top:24px">Competition record</h3>
    <p>${scoreCount} record(s) cached. ${lastScore ? `Latest: <strong>${lastScore.score}</strong> at ${esc(lastScore.match_name||'')} on ${esc(lastScore.match_date||'')}` : 'No scores synced yet.'}</p>

    <hr style="margin:28px 0"/>
    <h3>Auth controls</h3>
    <p style="color:#888;font-size:0.85rem">Last login: ${esc(m.last_login||'never')} · Must change password: ${m.must_change_password?'yes':'no'}</p>
    <form method="POST" action="/admin/members/${m.id}/reset-password" onsubmit="return confirm('Reset password back to ${esc(m.member_number)}temp1!?')">
      <button type="submit" class="btn btn-sm" style="background:var(--crimson);color:#fff;border:none;padding:8px 16px;border-radius:2px;cursor:pointer">Reset to temp password</button>
    </form>
  `));
});

router.post('/members/:id', express.urlencoded({ extended: true }), (req, res) => {
  const f = req.body;
  db.prepare(`UPDATE members SET email=?, vapa_id=?, trv_id=?, pistol_licence=?, pistol_licence_expiry=?, rifle_licence=?, rifle_licence_expiry=?, is_active=?, updated_at=datetime('now') WHERE id=?`)
    .run(
      (f.email||'').trim() || null,
      (f.vapa_id||'').trim() || null,
      (f.trv_id||'').trim() || null,
      (f.pistol_licence||'').trim() || null,
      (f.pistol_licence_expiry||'').trim() || null,
      (f.rifle_licence||'').trim() || null,
      (f.rifle_licence_expiry||'').trim() || null,
      f.is_active === '1' ? 1 : 0,
      req.params.id
    );
  res.redirect(`/admin/members/${req.params.id}`);
});

router.post('/members/:id/reset-password', (req, res) => {
  const m = db.prepare(`SELECT * FROM members WHERE id=?`).get(req.params.id);
  if (!m) return res.status(404).send('not found');
  const { salt, hash } = auth.hashPassword(auth.defaultPasswordFor(m.member_number));
  db.prepare(`UPDATE members SET password_hash=?, password_salt=?, must_change_password=1, updated_at=datetime('now') WHERE id=?`).run(hash, salt, m.id);
  db.prepare(`DELETE FROM member_sessions WHERE member_id=?`).run(m.id);
  res.redirect(`/admin/members/${m.id}`);
});

router.post('/members/:id/scores-sync', async (req, res) => {
  const m = db.prepare(`SELECT * FROM members WHERE id=?`).get(req.params.id);
  if (!m) return res.status(404).send('not found');
  try {
    const entries = await sp.memberScores(m.member_number);
    const insert = db.prepare(`
      INSERT INTO member_scores (member_id, match_id, match_name, match_date, detail, firearm_class, sub_class, calibre, grade, range_name, is_comp, score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(member_id, match_id) DO UPDATE SET
        match_name=excluded.match_name, match_date=excluded.match_date,
        firearm_class=excluded.firearm_class, sub_class=excluded.sub_class,
        calibre=excluded.calibre, grade=excluded.grade, range_name=excluded.range_name,
        is_comp=excluded.is_comp, score=excluded.score, synced_at=datetime('now')
    `);
    const tx = db.transaction(() => {
      entries.forEach(e => {
        const matchId = String(e.matchDetails||'');
        insert.run(m.id, matchId, e.matchName||null, matchId.slice(0,10)||null, String(e.detail||''),
          e.firearmClass||null, e.subClass||null, e.calibre||null, e.grade||null, e.range||null,
          e.isComp?1:0, Number(e.totalScoreRecorded)||0);
      });
    });
    tx();
    db.prepare(`UPDATE members SET sp_synced_at=datetime('now') WHERE id=?`).run(m.id);
    res.redirect(`/admin/members/${m.id}`);
  } catch (err) {
    res.redirect(`/admin/members/${m.id}?err=${encodeURIComponent(err.message.slice(0,160))}`);
  }
});

/* ── Documents admin (upload, list, delete) ─────────────── */
const DOC_DIR = path.join(__dirname, '..', 'data', 'documents');
const DOC_CATS = ['bylaws','minutes','policies','forms','annual-reports'];

router.get('/documents', (_req, res) => {
  const docs = db.prepare(`SELECT * FROM documents ORDER BY category, uploaded_at DESC`).all();
  res.send(shell('Documents', `
    <h1>Member documents (${docs.length})</h1>
    <details style="margin-bottom:20px"><summary style="cursor:pointer;color:var(--gold)">+ Upload new document</summary>
      <form method="POST" action="/admin/documents/upload" enctype="multipart/form-data" class="form" style="max-width:600px;margin-top:14px">
        <label>Title<input name="title" required maxlength="200"/></label>
        <label>Category<select name="category" required>${DOC_CATS.map(c=>`<option value="${c}">${c}</option>`).join('')}</select></label>
        <label>Description<textarea name="description" rows="2" maxlength="600"></textarea></label>
        <label>File (PDF, DOCX, etc.)<input name="file" type="file" required/></label>
        <button class="btn" type="submit">Upload</button>
      </form>
    </details>
    <table class="data-table">
      <thead><tr><th>Title</th><th>Category</th><th>Slug</th><th>File</th><th>Size</th><th>Uploaded</th><th></th></tr></thead>
      <tbody>
      ${docs.map(d => `<tr>
        <td>${esc(d.title)}</td>
        <td><code>${esc(d.category)}</code></td>
        <td><code>${esc(d.slug)}</code></td>
        <td>${esc(d.file_name||'')}</td>
        <td>${d.size_bytes?Math.round(d.size_bytes/1024)+' KB':''}</td>
        <td style="color:#888;font-size:0.78rem">${esc(d.uploaded_at||'')}</td>
        <td><a href="/members/documents/${esc(d.slug)}" target="_blank">View</a> · <form style="display:inline" method="POST" action="/admin/documents/${d.id}/delete" onsubmit="return confirm('Delete this document?')"><button type="submit" style="background:none;border:none;color:var(--crimson);cursor:pointer;padding:0">Delete</button></form></td>
      </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;color:#888;padding:32px">No documents uploaded yet.</td></tr>'}
      </tbody>
    </table>
  `));
});

router.post('/documents/upload', (req, res) => {
  // Built-in multipart handler — minimal, single-file
  const ct = req.headers['content-type'] || '';
  const m  = /boundary=(.+)$/.exec(ct);
  if (!m) return res.status(400).send('missing multipart boundary');
  const boundary = m[1];
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    try {
      const buf = Buffer.concat(chunks);
      const parts = parseMultipart(buf, boundary);
      const title    = (parts.title || '').toString().trim();
      const category = (parts.category || 'policies').toString().trim();
      const desc     = (parts.description || '').toString().trim();
      const file     = parts._file;
      if (!title || !file || !file.data || !file.data.length) return res.status(400).send('title + file required');
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80) + '-' + Date.now();
      fs.mkdirSync(DOC_DIR, { recursive: true });
      const safeExt = (file.filename.match(/\.[a-z0-9]+$/i) || ['.bin'])[0].toLowerCase();
      const stored  = slug + safeExt;
      fs.writeFileSync(path.join(DOC_DIR, stored), file.data);
      db.prepare(`INSERT INTO documents (title, slug, category, description, file_path, file_name, mime_type, size_bytes, is_members_only)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`)
        .run(title, slug, category, desc || null, stored, file.filename || stored, file.contentType || 'application/octet-stream', file.data.length);
      res.redirect('/admin/documents');
    } catch (err) {
      console.error('[admin] document upload failed', err);
      res.status(500).send('upload failed: ' + err.message);
    }
  });
});

router.post('/documents/:id/delete', (req, res) => {
  const d = db.prepare(`SELECT * FROM documents WHERE id=?`).get(req.params.id);
  if (d && d.file_path) {
    const abs = path.join(DOC_DIR, d.file_path);
    if (fs.existsSync(abs)) try { fs.unlinkSync(abs); } catch {}
  }
  db.prepare(`DELETE FROM documents WHERE id=?`).run(req.params.id);
  res.redirect('/admin/documents');
});

/* ── tiny multipart parser (single file + text fields) ───── */
function parseMultipart(buf, boundary) {
  const parts = {};
  const sep   = Buffer.from('--' + boundary);
  let idx     = buf.indexOf(sep);
  while (idx !== -1) {
    const next = buf.indexOf(sep, idx + sep.length);
    if (next === -1) break;
    const chunk = buf.slice(idx + sep.length, next);
    if (chunk.length > 4) {
      const headerEnd = chunk.indexOf('\r\n\r\n');
      if (headerEnd !== -1) {
        const headers = chunk.slice(0, headerEnd).toString();
        let body      = chunk.slice(headerEnd + 4);
        // trim trailing \r\n that separates from next boundary
        if (body.length >= 2 && body[body.length-2] === 0x0D && body[body.length-1] === 0x0A) body = body.slice(0, -2);
        const nameMatch = /name="([^"]+)"/.exec(headers);
        const fileMatch = /filename="([^"]*)"/.exec(headers);
        const ctMatch   = /Content-Type:\s*([^\r\n]+)/i.exec(headers);
        if (nameMatch) {
          if (fileMatch) {
            parts._file = { filename: fileMatch[1], contentType: ctMatch ? ctMatch[1].trim() : 'application/octet-stream', data: body };
          } else {
            parts[nameMatch[1]] = body.toString('utf8');
          }
        }
      }
    }
    idx = next;
  }
  return parts;
}

function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function stripTags(html) { return String(html).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(); }

module.exports = router;
