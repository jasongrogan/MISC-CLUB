#!/usr/bin/env node
/* ============================================================
   MISC-CLUB — One-off content scraper for www.misc.org.au
   ------------------------------------------------------------
   Logs in via the SWPM (Simple WordPress Membership) form, then
   walks every URL listed in the WordPress sitemap and saves:
     • content-import/pages/<slug>.json   { title, slug, html, text, images[] }
     • content-import/posts/<slug>.json
     • content-import/images/<filename>   (downloaded binaries)
     • content-import/_manifest.json      (full index)

   Run:
     SWPM_USER=tempreview SWPM_PASS='…' node scripts/scrape-misc.js
   ============================================================ */
const fs   = require('fs');
const path = require('path');
const https= require('https');
const { URL } = require('url');

const ROOT_DIR  = path.join(__dirname, '..', 'content-import');
const PAGES_DIR = path.join(ROOT_DIR, 'pages');
const POSTS_DIR = path.join(ROOT_DIR, 'posts');
const IMG_DIR   = path.join(ROOT_DIR, 'images');
[PAGES_DIR, POSTS_DIR, IMG_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

const SWPM_USER = process.env.SWPM_USER || '';
const SWPM_PASS = process.env.SWPM_PASS || '';
if (!SWPM_USER || !SWPM_PASS) {
  console.error('SWPM_USER and SWPM_PASS env vars required');
  process.exit(1);
}

const SITE  = 'misc.org.au';
const UA    = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const DELAY = 400; // ms between requests — be polite

const cookieJar = {};
function applySetCookies(headers) {
  const sc = headers['set-cookie'];
  if (!sc) return;
  sc.forEach(c => {
    const m = c.match(/^([^=]+)=([^;]*)/);
    if (m) cookieJar[m[1]] = m[2];
  });
}
function cookieHeader() {
  return Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
}

function request(method, urlStr, { body, contentType, followRedirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const opts = {
      method,
      hostname: u.hostname,
      path:     u.pathname + u.search,
      port:     443,
      headers: {
        'User-Agent':      UA,
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-AU,en;q=0.9',
      },
    };
    if (cookieHeader()) opts.headers['Cookie'] = cookieHeader();
    if (body) {
      opts.headers['Content-Type']   = contentType || 'application/x-www-form-urlencoded';
      opts.headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = https.request(opts, res => {
      applySetCookies(res.headers);
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && followRedirects > 0 && res.headers.location) {
        const next = new URL(res.headers.location, urlStr).toString();
        res.resume();
        return resolve(request(res.statusCode === 303 ? 'GET' : method, next, { body: res.statusCode === 303 ? null : body, contentType, followRedirects: followRedirects - 1 }));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
    if (body) req.write(body);
    req.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ── extremely small HTML parser — we only need title + main content + imgs */
function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
function extractTitle(html) {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  return m ? m[1].trim().replace(/&#8211;|&ndash;/g, '–').replace(/\s*[\|\-–]\s*MISC[^<]*$/i, '').trim() : '';
}
function extractMain(html) {
  // WordPress usually wraps content in #content, .entry-content, or <main>
  const patterns = [
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<div[^>]+class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<(?:footer|nav|aside|div class="[^"]*entry-footer)/i,
    /<div[^>]+id="content"[^>]*>([\s\S]*?)<\/div>\s*<(?:footer|aside)/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1].length > 200) return m[1];
  }
  return html;  // fallback
}
function extractImages(html, baseUrl) {
  const imgs = [];
  const re = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    try { imgs.push(new URL(m[1], baseUrl).toString()); } catch (_) {}
  }
  return [...new Set(imgs)];
}
function isMemberRestricted(html) {
  return /You need to login to view this content|swpm-no-access|members-only-content/i.test(html);
}

/* ── login ────────────────────────────────────────────────── */
async function login() {
  console.log(`→ Logging in as ${SWPM_USER}…`);
  // First GET the login page so we capture any nonces / initial cookies
  const pre = await request('GET', `https://${SITE}/index.php/membership-login/`);
  if (pre.status !== 200) console.warn(`  login page returned HTTP ${pre.status}`);
  // Submit credentials (form action is the homepage)
  const body =
    `swpm_user_name=${encodeURIComponent(SWPM_USER)}` +
    `&swpm_password=${encodeURIComponent(SWPM_PASS)}` +
    `&rememberme=forever` +
    `&swpm-login=Log+In` +
    `&swpm_login_origination_flag=1`;
  const res = await request('POST', `https://${SITE}/`, { body });
  const html = res.body.toString('utf8');
  const looksAuthed = /swpm_in_log|Log Out|swpm-logout|membership-profile/i.test(html);
  console.log(`  HTTP ${res.status}, authed-marker ${looksAuthed ? 'YES' : 'NO'}, cookies: ${Object.keys(cookieJar).length}`);
  return looksAuthed;
}

/* ── fetch and store one URL ──────────────────────────────── */
function slugifyUrl(u) {
  const p = new URL(u).pathname.replace(/^\/index\.php\//, '').replace(/\/$/, '');
  return (p || 'home').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
}

async function fetchPage(url, outDir) {
  const slug = slugifyUrl(url);
  const outFile = path.join(outDir, `${slug}.json`);
  try {
    const res = await request('GET', url);
    if (res.status !== 200) {
      console.warn(`  [${res.status}] ${url}`);
      return { url, slug, status: res.status, error: `HTTP ${res.status}` };
    }
    const html = res.body.toString('utf8');
    const title = extractTitle(html);
    const main  = extractMain(html);
    const text  = stripTags(main).slice(0, 50000);
    const images = extractImages(main, url);
    const memberRestricted = isMemberRestricted(html);
    fs.writeFileSync(outFile, JSON.stringify({
      url, slug, title, html_main: main, text, images, member_restricted: memberRestricted,
      crawled_at: new Date().toISOString(),
    }, null, 2));
    console.log(`  ✓ ${slug.padEnd(45)} (${text.length} chars, ${images.length} imgs)${memberRestricted ? ' [RESTRICTED]' : ''}`);
    return { url, slug, title, text_length: text.length, images: images.length, member_restricted: memberRestricted };
  } catch (err) {
    console.error(`  ✗ ${url}: ${err.message}`);
    return { url, slug, error: err.message };
  }
}

/* ── download images ──────────────────────────────────────── */
async function downloadImages(imageUrls) {
  console.log(`\n→ Downloading ${imageUrls.length} images…`);
  let done = 0;
  for (const imgUrl of imageUrls) {
    try {
      const u = new URL(imgUrl);
      if (!u.hostname.endsWith('misc.org.au')) continue;
      const filename = path.basename(u.pathname);
      if (!filename) continue;
      const outPath = path.join(IMG_DIR, filename);
      if (fs.existsSync(outPath)) { done++; continue; }
      const res = await request('GET', imgUrl);
      if (res.status === 200 && res.body.length > 0) {
        fs.writeFileSync(outPath, res.body);
        done++;
      }
      await sleep(150);
    } catch (e) { /* skip */ }
  }
  console.log(`  ✓ ${done} images saved to ${IMG_DIR}`);
}

/* ── main ────────────────────────────────────────────────── */
(async () => {
  const t0 = Date.now();
  const pageUrls = fs.readFileSync('/tmp/misc-crawl/all-pages.txt', 'utf8').trim().split('\n').filter(Boolean);
  const postUrls = fs.readFileSync('/tmp/misc-crawl/all-posts.txt', 'utf8').trim().split('\n').filter(Boolean);
  console.log(`Crawl plan: ${pageUrls.length} pages + ${postUrls.length} posts`);

  const ok = await login();
  if (!ok) {
    console.warn('⚠ Login may have failed — proceeding anyway (public-only crawl)');
  }

  console.log('\n→ Fetching PAGES…');
  const pageResults = [];
  for (const url of pageUrls) {
    pageResults.push(await fetchPage(url, PAGES_DIR));
    await sleep(DELAY);
  }

  console.log('\n→ Fetching POSTS…');
  const postResults = [];
  for (const url of postUrls) {
    postResults.push(await fetchPage(url, POSTS_DIR));
    await sleep(DELAY);
  }

  // Aggregate all images and download
  const allImages = new Set();
  [...fs.readdirSync(PAGES_DIR), ...fs.readdirSync(POSTS_DIR)].forEach(f => {
    if (!f.endsWith('.json')) return;
    const p = fs.existsSync(path.join(PAGES_DIR, f)) ? path.join(PAGES_DIR, f) : path.join(POSTS_DIR, f);
    try { (JSON.parse(fs.readFileSync(p, 'utf8')).images || []).forEach(u => allImages.add(u)); } catch (_) {}
  });
  await downloadImages([...allImages]);

  const manifest = {
    crawled_at: new Date().toISOString(),
    site: `https://${SITE}/`,
    pages: pageResults,
    posts: postResults,
    stats: {
      pages_total: pageResults.length,
      pages_ok:    pageResults.filter(r => !r.error).length,
      posts_total: postResults.length,
      posts_ok:    postResults.filter(r => !r.error).length,
      member_restricted: pageResults.filter(r => r.member_restricted).length + postResults.filter(r => r.member_restricted).length,
      images_downloaded: fs.readdirSync(IMG_DIR).length,
      runtime_seconds: Math.round((Date.now() - t0) / 1000),
    },
  };
  fs.writeFileSync(path.join(ROOT_DIR, '_manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('\n=== DONE ===');
  console.log(JSON.stringify(manifest.stats, null, 2));
})().catch(err => { console.error(err); process.exit(1); });
