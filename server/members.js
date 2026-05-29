/* ============================================================
   MISC CLUB — Member portal (auth, dashboard, profile, scores)
   ============================================================ */
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const db      = require('./db');
const auth    = require('./auth');
const sp      = require('./sight-picture');

const router = express.Router();

/* ── helpers ─────────────────────────────────────────────── */
function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function titleCase(s) {
  if (!s) return '';
  return String(s).toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}
function splitName(displayName) {
  const parts = String(displayName || '').trim().split(/\s+/);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  return d.toLocaleDateString('en-AU', { day:'numeric', month:'short', year:'numeric' });
}

/* ── shared HTML shell for member-portal pages ──────────── */
function shell(title, body, opts = {}) {
  const m = opts.member;
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${esc(title)} — MISC Members</title>
<link rel="icon" href="/images/MISC-Colour-6x-1-300x294.png"/>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800;900&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet"/>
<link rel="stylesheet" href="/css/styles.css?v=9"/></head>
<body class="members-page">
<div class="topstrip">A private, members-only club &nbsp;·&nbsp; Port Melbourne, Victoria &nbsp;·&nbsp; Affiliated with <a href="https://www.vapa.org.au" target="_blank" rel="noopener">VAPA</a> &amp; <a href="https://www.trv.org.au" target="_blank" rel="noopener">TRV</a></div>
<header class="topbar scrolled" id="topbar">
  <a class="logo" href="/"><img src="/images/MISC-Colour-6x-1-300x294.png" alt="MISC" width="36" height="36"/>
    <span><strong>MISC</strong><em>Members Area</em></span></a>
  <nav class="topnav">
    ${m ? `
      <a href="/members/" class="${opts.page==='dashboard'?'active':''}">Dashboard</a>
      <a href="/members/profile" class="${opts.page==='profile'?'active':''}">Profile</a>
      <a href="/members/scores" class="${opts.page==='scores'?'active':''}">Scores</a>
      <a href="/members/documents" class="${opts.page==='documents'?'active':''}">Documents</a>
      <a href="/calendar">Calendar</a>
    ` : `
      <a href="/">Home</a>
      <a href="/calendar">Calendar</a>
      <a href="/forms/contact">Contact</a>
    `}
  </nav>
  ${m ? `<form method="POST" action="/members/logout" style="display:inline"><button class="btn btn-ghost btn-sm" type="submit">Sign out</button></form>` :
        `<a href="/members/login" class="btn btn-gold btn-sm">Sign in</a>`}
</header>
<main class="members-main">${body}</main>
<footer class="site-footer"><div class="container footer-bar">
  <p>&copy; 2026 Melbourne International Shooting Club · <a href="mailto:miscevents@misc.org.au">miscevents@misc.org.au</a></p>
  <p>120–128 Todd Road, Port Melbourne VIC 3207</p>
</div></footer>
</body></html>`;
}

/* ── LOGIN ───────────────────────────────────────────────── */
router.get('/login', (req, res) => {
  if (auth.getCurrentMember(req)) return res.redirect('/members/');
  const err = req.query.bad ? '<p class="auth-err">Member number or password not recognised.</p>' : '';
  const next = req.query.next ? `<input type="hidden" name="next" value="${esc(req.query.next)}"/>` : '';
  res.send(shell('Sign in', `
    <div class="container auth-container">
      <div class="auth-card">
        <span class="section-eyebrow">Members Area</span>
        <h1 class="auth-title">Welcome back to <span class="gold">MISC</span>.</h1>
        <p class="auth-sub">Sign in with your <strong>MISC member number</strong>. If this is your first time, your temporary password is your member number followed by <code>temp1!</code> — you'll be asked to change it on arrival.</p>
        ${err}
        <form method="POST" action="/members/login" class="form auth-form">
          ${next}
          <label>Member number <input name="member_number" required autofocus inputmode="numeric" pattern="[0-9]+" autocomplete="username"/></label>
          <label>Password <input name="password" type="password" required autocomplete="current-password"/></label>
          <button class="btn btn-gold" type="submit">Sign in</button>
        </form>
        <p class="auth-help">Lost your password? Email <a href="mailto:miscevents@misc.org.au">miscevents@misc.org.au</a> and the committee will reset it.</p>
      </div>
    </div>
  `));
});

router.post('/login', (req, res) => {
  const num  = String(req.body.member_number || '').trim();
  const pass = String(req.body.password || '');
  const next = String(req.body.next || '/members/');
  if (!num || !pass) return res.redirect('/members/login?bad=1');
  const member = db.prepare(`SELECT * FROM members WHERE member_number = ? AND is_active = 1`).get(num);
  if (!member || !member.password_hash) return res.redirect('/members/login?bad=1');
  if (!auth.verifyPassword(pass, member.password_salt, member.password_hash)) {
    return res.redirect('/members/login?bad=1');
  }
  const token = auth.createSession(member.id);
  auth.setMemberCookie(res, token);
  db.prepare(`UPDATE members SET last_login = datetime('now') WHERE id = ?`).run(member.id);
  res.redirect(member.must_change_password ? '/members/change-password' : (next.startsWith('/members') || next.startsWith('/calendar') ? next : '/members/'));
});

router.post('/logout', (req, res) => {
  const m = auth.getCurrentMember(req);
  if (m) auth.destroySession(m._session_token);
  auth.clearMemberCookie(res);
  res.redirect('/members/login');
});

/* ── everything below requires auth ─────────────────────── */
router.use(auth.requireMember);

/* ── CHANGE PASSWORD (forced on first login) ─────────────── */
router.get('/change-password', (req, res) => {
  const m = req.member;
  const forced = m.must_change_password;
  res.send(shell('Change password', `
    <div class="container auth-container">
      <div class="auth-card">
        <span class="section-eyebrow">${forced ? 'First sign-in' : 'Account'}</span>
        <h1 class="auth-title">${forced ? 'Set your new password' : 'Change your password'}</h1>
        ${forced ? `<p class="auth-sub">Welcome, <strong>${esc(titleCase(m.display_name))}</strong>. Please choose a new password before continuing — at least 8 characters.</p>`
                 : `<p class="auth-sub">Update the password on your account. Choose at least 8 characters.</p>`}
        ${req.query.bad ? '<p class="auth-err">Passwords did not match, or the new password is too short.</p>' : ''}
        ${req.query.wrongcurrent ? '<p class="auth-err">Current password was not correct.</p>' : ''}
        <form method="POST" action="/members/change-password" class="form auth-form">
          ${forced ? '' : `<label>Current password <input name="current_password" type="password" required autocomplete="current-password"/></label>`}
          <label>New password <input name="new_password" type="password" minlength="8" required autocomplete="new-password"/></label>
          <label>Confirm new password <input name="confirm_password" type="password" minlength="8" required autocomplete="new-password"/></label>
          <button class="btn btn-gold" type="submit">Save password</button>
        </form>
      </div>
    </div>
  `, { member: m, page: 'profile' }));
});

router.post('/change-password', (req, res) => {
  const m   = req.member;
  const cur = String(req.body.current_password || '');
  const nw  = String(req.body.new_password || '');
  const cf  = String(req.body.confirm_password || '');
  if (nw.length < 8 || nw !== cf) return res.redirect('/members/change-password?bad=1');
  if (!m.must_change_password) {
    if (!auth.verifyPassword(cur, m.password_salt, m.password_hash)) {
      return res.redirect('/members/change-password?wrongcurrent=1');
    }
  }
  const { salt, hash } = auth.hashPassword(nw);
  db.prepare(`UPDATE members SET password_hash = ?, password_salt = ?, must_change_password = 0, updated_at = datetime('now') WHERE id = ?`)
    .run(hash, salt, m.id);
  res.redirect('/members/?changed=1');
});

/* ── DASHBOARD ───────────────────────────────────────────── */
router.get('/', (req, res) => {
  const m = req.member;
  const scoreCount = db.prepare(`SELECT COUNT(*) AS n FROM member_scores WHERE member_id = ?`).get(m.id).n;
  const latest = db.prepare(`SELECT * FROM member_scores WHERE member_id = ? ORDER BY match_date DESC, id DESC LIMIT 1`).get(m.id);
  const best   = db.prepare(`SELECT MAX(score) AS s FROM member_scores WHERE member_id = ? AND is_comp = 1`).get(m.id);
  const docCount = db.prepare(`SELECT COUNT(*) AS n FROM documents WHERE is_members_only = 1`).get().n;
  const expiring = [
    m.pistol_licence_expiry && new Date(m.pistol_licence_expiry) < new Date(Date.now() + 60*86400000) ? 'Pistol' : null,
    m.rifle_licence_expiry  && new Date(m.rifle_licence_expiry)  < new Date(Date.now() + 60*86400000) ? 'Long-arm' : null,
  ].filter(Boolean);
  const changedMsg = req.query.changed ? '<div class="flash-ok">Password updated.</div>' : '';

  res.send(shell('Dashboard', `
    <div class="container">
      ${changedMsg}
      <div class="members-hero">
        <span class="section-eyebrow">Members Area</span>
        <h1>Welcome back, <span class="gold">${esc(titleCase(m.display_name).split(' ')[0] || 'Shooter')}</span>.</h1>
        <p class="members-hero-sub">Signed in as MISC #${esc(m.member_number)} · <a href="/members/profile" style="color:var(--gold)">View profile →</a></p>
      </div>

      ${expiring.length ? `<div class="flash-warn">⚠ ${expiring.join(' & ')} licence expires within 60 days — update your <a href="/members/profile">profile</a>.</div>` : ''}

      <div class="members-grid">
        <a class="members-tile" href="/members/profile">
          <span class="tile-eyebrow">Profile</span>
          <h3>${esc(titleCase(m.display_name))}</h3>
          <p>${m.email ? esc(m.email) : '<em>No email on file</em>'}</p>
          <span class="tile-arrow">View & edit →</span>
        </a>

        <a class="members-tile" href="/members/scores">
          <span class="tile-eyebrow">Competition record</span>
          <h3>${scoreCount} <small>scored entries</small></h3>
          <p>${best && best.s ? `Best competition score: <strong style="color:var(--gold)">${best.s}</strong>` : 'No competition scores synced yet.'}</p>
          <span class="tile-arrow">View scores →</span>
        </a>

        <a class="members-tile" href="/members/documents">
          <span class="tile-eyebrow">Club library</span>
          <h3>${docCount} <small>documents</small></h3>
          <p>Bylaws, minutes, policies &amp; member forms.</p>
          <span class="tile-arrow">Open library →</span>
        </a>
      </div>

      ${latest ? `
        <h3 class="members-section-h">Latest result</h3>
        <div class="members-latest">
          <div class="latest-score">${latest.score}</div>
          <div class="latest-body">
            <h4>${esc(latest.match_name || 'Match')}</h4>
            <p>${esc(fmtDate(latest.match_date))} · ${esc(latest.firearm_class || '')}${latest.calibre?' · '+esc(latest.calibre):''}${latest.grade?' · '+esc(latest.grade):''}</p>
          </div>
        </div>
      ` : ''}

      <h3 class="members-section-h">Quick actions</h3>
      <div class="members-actions">
        <form method="POST" action="/members/scores/sync" style="display:inline"><button class="btn btn-ghost" type="submit">↻ Re-sync my scores from Sight Picture</button></form>
        <a class="btn btn-ghost" href="/members/change-password">Change password</a>
      </div>
    </div>
  `, { member: m, page: 'dashboard' }));
});

/* ── PROFILE (view + edit) ───────────────────────────────── */
router.get('/profile', (req, res) => {
  const m = req.member;
  const ok = req.query.saved ? '<div class="flash-ok">Profile saved.</div>' : '';
  res.send(shell('Profile', `
    <div class="container">
      ${ok}
      <div class="members-hero">
        <span class="section-eyebrow">Profile</span>
        <h1>${esc(titleCase(m.display_name))}</h1>
        <p class="members-hero-sub">MISC member #${esc(m.member_number)}</p>
      </div>

      <form method="POST" action="/members/profile" class="form profile-form">
        <fieldset class="profile-section">
          <legend>Identity</legend>
          <div class="row">
            <label>Member number<input value="${esc(m.member_number)}" disabled/></label>
            <label>Email<input name="email" type="email" value="${esc(m.email||'')}" maxlength="200"/></label>
          </div>
          <div class="row">
            <label>First name<input name="first_name" value="${esc(m.first_name||'')}" maxlength="80"/></label>
            <label>Last name<input name="last_name" value="${esc(m.last_name||'')}" maxlength="80"/></label>
          </div>
        </fieldset>

        <fieldset class="profile-section">
          <legend>Affiliations</legend>
          <div class="row">
            <label>VAPA ID<input name="vapa_id" value="${esc(m.vapa_id||'')}" placeholder="if known"/></label>
            <label>TRV ID<input name="trv_id" value="${esc(m.trv_id||'')}" placeholder="if known"/></label>
          </div>
          <p class="profile-help">Only you and the MISC admin can see these IDs.</p>
        </fieldset>

        <fieldset class="profile-section">
          <legend>Pistol (handgun) licence</legend>
          <div class="row">
            <label>Licence number<input name="pistol_licence" value="${esc(m.pistol_licence||'')}" placeholder="e.g. 413-100-00H"/></label>
            <label>Expiry date<input name="pistol_licence_expiry" type="date" value="${esc(m.pistol_licence_expiry||'')}"/></label>
          </div>
        </fieldset>

        <fieldset class="profile-section">
          <legend>Long-arm (rifle) licence</legend>
          <div class="row">
            <label>Licence number<input name="rifle_licence" value="${esc(m.rifle_licence||'')}"/></label>
            <label>Expiry date<input name="rifle_licence_expiry" type="date" value="${esc(m.rifle_licence_expiry||'')}"/></label>
          </div>
        </fieldset>

        <div class="form-actions">
          <button class="btn btn-gold" type="submit">Save profile</button>
          <a class="btn btn-ghost" href="/members/">Cancel</a>
        </div>
      </form>
    </div>
  `, { member: m, page: 'profile' }));
});

router.post('/profile', (req, res) => {
  const m = req.member;
  const f = req.body || {};
  db.prepare(`UPDATE members SET
      email = ?, first_name = ?, last_name = ?,
      vapa_id = ?, trv_id = ?,
      pistol_licence = ?, pistol_licence_expiry = ?,
      rifle_licence = ?, rifle_licence_expiry = ?,
      updated_at = datetime('now')
    WHERE id = ?`)
    .run(
      (f.email||'').trim() || null,
      (f.first_name||'').trim() || null,
      (f.last_name||'').trim() || null,
      (f.vapa_id||'').trim() || null,
      (f.trv_id||'').trim() || null,
      (f.pistol_licence||'').trim() || null,
      (f.pistol_licence_expiry||'').trim() || null,
      (f.rifle_licence||'').trim() || null,
      (f.rifle_licence_expiry||'').trim() || null,
      m.id
    );
  res.redirect('/members/profile?saved=1');
});

/* ── SCORES ──────────────────────────────────────────────── */
router.get('/scores', (req, res) => {
  const m = req.member;
  const scores = db.prepare(`SELECT * FROM member_scores WHERE member_id = ? ORDER BY match_date DESC, id DESC`).all(m.id);
  const compScores = scores.filter(s => s.is_comp);
  const best   = compScores.length ? Math.max(...compScores.map(s => s.score)) : null;
  const avg    = compScores.length ? Math.round(compScores.reduce((a, s) => a + s.score, 0) / compScores.length) : null;
  const synced = req.query.synced ? `<div class="flash-ok">Scores re-synced from Sight Picture: ${esc(req.query.synced)} records.</div>` : '';
  const failed = req.query.failed ? `<div class="flash-warn">Sync failed: ${esc(req.query.failed)}</div>` : '';

  // Chart-friendly time series (oldest→newest)
  const series = [...compScores].reverse().map(s => ({ d: s.match_date, y: s.score, n: s.match_name }));

  res.send(shell('Scores', `
    <div class="container">
      ${synced}${failed}
      <div class="members-hero">
        <span class="section-eyebrow">Competition record</span>
        <h1>Your <span class="gold">last 2 years</span> on the line.</h1>
        <p class="members-hero-sub">${scores.length} record${scores.length===1?'':'s'} cached from Sight Picture${m.sp_synced_at?` · last synced ${esc(fmtDate(m.sp_synced_at))}`:''}.</p>
      </div>

      <div class="score-stats">
        <div><strong>${compScores.length}</strong><span>Competition shoots</span></div>
        <div><strong>${best ?? '—'}</strong><span>Best score</span></div>
        <div><strong>${avg ?? '—'}</strong><span>Average</span></div>
      </div>

      ${series.length > 1 ? `<div class="score-chart-wrap"><canvas id="score-chart" height="220"></canvas></div>` : ''}

      <div class="members-actions" style="margin: 24px 0 40px">
        <form method="POST" action="/members/scores/sync" style="display:inline"><button class="btn btn-gold" type="submit">↻ Re-sync from Sight Picture</button></form>
      </div>

      ${scores.length ? `
        <table class="data-table scores-table">
          <thead><tr><th>Date</th><th>Match</th><th>Class</th><th>Calibre</th><th>Grade</th><th>Score</th><th>Type</th></tr></thead>
          <tbody>
            ${scores.map(s => `<tr>
              <td>${esc(fmtDate(s.match_date))}</td>
              <td>${esc(s.match_name||'')}</td>
              <td>${esc(s.firearm_class||'')}${s.sub_class?` <small style="color:var(--dim)">${esc(s.sub_class)}</small>`:''}</td>
              <td>${esc(s.calibre||'')}</td>
              <td>${esc(s.grade||'')}</td>
              <td><strong>${s.score}</strong></td>
              <td><small style="color:${s.is_comp?'var(--gold)':'var(--dim)'}">${s.is_comp?'COMP':'practice'}</small></td>
            </tr>`).join('')}
          </tbody>
        </table>
      ` : `<div class="empty-state">
        <p>No scores synced yet.</p>
        <form method="POST" action="/members/scores/sync"><button class="btn btn-gold" type="submit">Pull my scores from Sight Picture</button></form>
      </div>`}
    </div>

    ${series.length > 1 ? `
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
    <script>
      const series = ${JSON.stringify(series)};
      const ctx = document.getElementById('score-chart');
      new Chart(ctx, {
        type: 'line',
        data: { labels: series.map(s => s.d), datasets: [{
          label: 'Competition score',
          data: series.map(s => s.y),
          borderColor: '#C9A84C', backgroundColor: 'rgba(201,168,76,.15)',
          pointBackgroundColor: '#C9A84C', tension: 0.25, fill: true, borderWidth: 2,
        }]},
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { title: (items) => series[items[0].dataIndex]?.n + ' · ' + series[items[0].dataIndex]?.d } } },
          scales: {
            x: { ticks: { color: '#9A9A9A', maxRotation: 0, autoSkipPadding: 18 }, grid: { color: 'rgba(255,255,255,.04)' } },
            y: { ticks: { color: '#9A9A9A' }, grid: { color: 'rgba(255,255,255,.06)' } },
          }
        }
      });
    </script>` : ''}
  `, { member: m, page: 'scores' }));
});

router.post('/scores/sync', async (req, res) => {
  const m = req.member;
  try {
    const entries = await sp.memberScores(m.member_number);
    const insert = db.prepare(`
      INSERT INTO member_scores (member_id, match_id, match_name, match_date, detail, firearm_class, sub_class, calibre, grade, range_name, is_comp, score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(member_id, match_id) DO UPDATE SET
        match_name = excluded.match_name,
        match_date = excluded.match_date,
        firearm_class = excluded.firearm_class,
        sub_class = excluded.sub_class,
        calibre = excluded.calibre,
        grade = excluded.grade,
        range_name = excluded.range_name,
        is_comp = excluded.is_comp,
        score = excluded.score,
        synced_at = datetime('now')
    `);
    const tx = db.transaction(() => {
      entries.forEach(e => {
        const matchId = String(e.matchDetails || '');
        const date    = matchId.length >= 10 ? matchId.slice(0, 10) : null;
        const detail  = String(e.detail || '');
        insert.run(
          m.id, matchId,
          e.matchName || null, date, detail,
          e.firearmClass || null, e.subClass || null, e.calibre || null,
          e.grade || null, e.range || null,
          e.isComp ? 1 : 0,
          Number(e.totalScoreRecorded) || 0
        );
      });
    });
    tx();
    db.prepare(`UPDATE members SET sp_synced_at = datetime('now') WHERE id = ?`).run(m.id);
    res.redirect(`/members/scores?synced=${entries.length}`);
  } catch (err) {
    console.error('[members] score sync failed', err);
    res.redirect(`/members/scores?failed=${encodeURIComponent(err.message.slice(0,140))}`);
  }
});

/* ── DOCUMENTS LIBRARY ───────────────────────────────────── */
const CAT_NAMES = {
  'bylaws':         'Bylaws & Constitution',
  'minutes':        'Committee Minutes',
  'policies':       'Club Policies',
  'forms':          'Member Forms',
  'annual-reports': 'Annual Reports',
};

router.get('/documents', (req, res) => {
  const m = req.member;
  const docs = db.prepare(`SELECT * FROM documents WHERE is_members_only = 1 ORDER BY category, uploaded_at DESC`).all();
  const grouped = {};
  docs.forEach(d => { (grouped[d.category] = grouped[d.category] || []).push(d); });

  const sections = Object.keys(CAT_NAMES).map(cat => {
    const list = grouped[cat] || [];
    if (!list.length) return '';
    return `<section class="doc-section">
      <h3>${esc(CAT_NAMES[cat])} <small>(${list.length})</small></h3>
      <div class="doc-grid">
        ${list.map(d => `<a class="doc-card" href="/members/documents/${esc(d.slug)}">
          <span class="doc-icon">📄</span>
          <h4>${esc(d.title)}</h4>
          ${d.description ? `<p>${esc(d.description)}</p>` : ''}
          <span class="doc-meta">${esc(d.file_name||'')} · ${(d.size_bytes/1024).toFixed(0)} KB · ${esc(fmtDate(d.uploaded_at))}</span>
        </a>`).join('')}
      </div>
    </section>`;
  }).join('');

  res.send(shell('Documents', `
    <div class="container">
      <div class="members-hero">
        <span class="section-eyebrow">Members Library</span>
        <h1>Club <span class="gold">documents</span>.</h1>
        <p class="members-hero-sub">Bylaws, committee minutes, policies and member forms. ${docs.length} document${docs.length===1?'':'s'}.</p>
      </div>
      ${docs.length ? sections : `<div class="empty-state"><p>No documents in the library yet — the committee will be uploading bylaws, minutes and policies here.</p></div>`}
    </div>
  `, { member: m, page: 'documents' }));
});

router.get('/documents/:slug', (req, res) => {
  const doc = db.prepare(`SELECT * FROM documents WHERE slug = ? AND is_members_only = 1`).get(req.params.slug);
  if (!doc || !doc.file_path) return res.status(404).send('not found');
  const abs = path.join(__dirname, '..', 'data', 'documents', doc.file_path);
  if (!fs.existsSync(abs)) return res.status(404).send('file missing');
  res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${doc.file_name || 'document'}"`);
  fs.createReadStream(abs).pipe(res);
});

/* ── tiny JSON endpoint used by client-side widgets ──────── */
router.get('/api/me', (req, res) => {
  const m = req.member;
  res.json({
    id: m.id,
    member_number: m.member_number,
    display_name: m.display_name,
    email: m.email,
    must_change_password: !!m.must_change_password,
  });
});

module.exports = router;
