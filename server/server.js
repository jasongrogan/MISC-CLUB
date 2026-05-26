/* ============================================================
   MISC CLUB — Express server (concept site)
   ============================================================ */
const path    = require('path');
const express = require('express');
const db      = require('./db');
const api     = require('./api');
const admin   = require('./admin');

const app  = express();
const PORT = process.env.PORT || 3100;

app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true, limit: '256kb' }));

// Static assets and imported images
app.use('/images', express.static(path.join(__dirname, '..', 'public', 'images')));
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

// Forms (GET form pages + POST submissions) — mounted at root since paths
// already include /forms/ prefix in the router.
app.use('/', api);

// Admin (HTML + JSON API)
app.use('/admin', admin);

// Dynamic content page renderer — /p/:slug renders a page from DB
app.get('/p/:slug', (req, res) => {
  const slug = String(req.params.slug).trim().toLowerCase();
  const page = db.prepare(`SELECT * FROM pages WHERE slug = ? AND is_published = 1`).get(slug);
  if (!page) return res.status(404).send(renderShell('Page not found', '<h1>404 — not found</h1>'));
  if (page.is_members_only) {
    return res.send(renderShell(page.title, `<div class="members-gate"><h1>${esc(page.title)}</h1><p>This page is for members only. Please sign in to view.</p><p><em>Members area coming soon — this is the concept site.</em></p></div>`));
  }
  res.send(renderShell(page.title, page.body_html, { slug }));
});

// News post renderer
app.get('/news/:slug', (req, res) => {
  const slug = String(req.params.slug).trim().toLowerCase();
  const post = db.prepare(`SELECT * FROM posts WHERE slug = ? AND is_published = 1`).get(slug);
  if (!post) return res.status(404).send(renderShell('Post not found', '<h1>404 — not found</h1>'));
  res.send(renderShell(post.title, `<article><h1>${esc(post.title)}</h1>${post.body_html}</article>`));
});

app.get('/healthz', (_req, res) => res.json({ ok: true, ts: Date.now() }));

/* ── HTML shell ────────────────────────────────────────── */
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function renderShell(title, bodyHtml, opts = {}) {
  const nav = db.prepare(`SELECT slug, title, nav_group FROM pages WHERE is_published = 1 AND nav_group IS NOT NULL ORDER BY nav_group, nav_order, title`).all();
  const navGroups = {};
  nav.forEach(p => { (navGroups[p.nav_group] = navGroups[p.nav_group] || []).push(p); });
  const navHtml = Object.entries(navGroups).map(([group, pages]) => `
    <div class="nav-group">
      <span class="nav-group-label">${esc(group)}</span>
      <div class="nav-group-items">
        ${pages.map(p => `<a href="/p/${esc(p.slug)}" class="${opts.slug===p.slug?'active':''}">${esc(p.title)}</a>`).join('')}
      </div>
    </div>`).join('');
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${esc(title)} — MISC</title>
<link rel="icon" href="/images/MISC-Colour-6x-1-300x294.png"/>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800;900&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet"/>
<link rel="stylesheet" href="/css/styles.css"/>
</head><body class="page-wrap">
<header class="site-header">
  <div class="brand"><a href="/"><strong>MISC</strong></a></div>
  <nav class="main-nav">
    <a href="/">Home</a>
    <a href="/forms/contact">Contact</a>
    <a href="/forms/join">Join</a>
    <a href="/forms/training">Training</a>
  </nav>
</header>
<aside class="side-nav">${navHtml}</aside>
<main class="content">${bodyHtml}</main>
<footer class="site-footer">
  <div class="container footer-bar">
    <p>&copy; 2026 Melbourne International Shooting Club · <a href="/forms/contact">miscevents@misc.org.au</a></p>
    <p>120–128 Todd Road, Port Melbourne</p>
  </div>
</footer>
</body></html>`;
}

app.locals.renderShell = renderShell;
app.set('view-helpers', { renderShell, esc });

app.listen(PORT, () => {
  console.log(`\n✓ MISC Club running at http://localhost:${PORT}`);
  console.log(`  Admin:  http://localhost:${PORT}/admin/`);
  console.log(`  Page:   http://localhost:${PORT}/p/about-misc\n`);
});

module.exports = { renderShell, esc };
