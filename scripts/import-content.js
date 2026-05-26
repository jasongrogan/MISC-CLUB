#!/usr/bin/env node
/* ============================================================
   MISC CLUB — Import scraped content from /content-import into DB
   ============================================================ */
const fs = require('fs');
const path = require('path');
const db = require('../server/db');

const IMPORT_DIR = path.join(__dirname, '..', 'content-import');
const PAGES_DIR  = path.join(IMPORT_DIR, 'pages');
const POSTS_DIR  = path.join(IMPORT_DIR, 'posts');
const IMG_DIR    = path.join(IMPORT_DIR, 'images');
const PUBLIC_IMG = path.join(__dirname, '..', 'public', 'images');

/* ── nav group classification ─────────────────────────── */
function classifySlug(slug) {
  if (/^(home|mainpage)$/i.test(slug)) return null;
  if (/membersarea|memberscoaching|member-handbook|member-booking|member-details|membership-login|membership-profile|password-reset|committee-meeting|range-orders|score-sheets/i.test(slug)) return { nav_group: 'members', members_only: 1, order: 50 };
  if (/^about-misc|club-history|our-values|honour-board|club-champions|olympians|commonwealth|national-champions|deaflympics|theclub|purpose-and-rules|governance|history-of-pistol|a-blast/i.test(slug)) return { nav_group: 'about', members_only: 0, order: 20 };
  if (/^(rifle|air-rifle|prone-shooting|bench-rest|positional|sport-rifle|pistol|10m-air-pistol|25m-|50m-pistol|service-|wa1500|world-association-1500|standard-revolver|single-action|ipsc|combined-services|cowboy|black-powder|rapid-fire|standard-pistol|distinguished|target-pistol|rifle-target|c-f-sp|match-32-3p)/i.test(slug)) return { nav_group: 'disciplines', members_only: 0, order: 30 };
  if (/^how-to-join|membership-fees|membership-join|find-a-gun-dealer|frequently-asked|purchasing-a-handgun|training-plan|resources|files|issf-comp-rules/i.test(slug)) return { nav_group: 'how-to', members_only: 0, order: 40 };
  if (/^(contact-us|map-to-club|privacy-policy)/i.test(slug)) return { nav_group: 'contact', members_only: 0, order: 60 };
  if (/^competitions|competition-results|misc-open|state-titles|24-hour|air-range-development|ragnar/i.test(slug)) return { nav_group: 'competitions', members_only: 0, order: 35 };
  return { nav_group: null, members_only: 0, order: 100 };  // unfiled
}

/* ── HTML cleaning: strip WP chrome, fix image URLs ────── */
function cleanBody(html, sourceUrl) {
  if (!html) return '';
  return html
    // Drop scripts / styles / share widgets / wp shortcodes / comments
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<form[\s\S]*?<\/form>/gi, '')           // remove WP login forms
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // Re-host image URLs from misc.org.au to /images/<basename>
    .replace(/src=["']https?:\/\/misc\.org\.au\/wp-content\/uploads\/[^"']+\/([^"'\/]+)["']/g, 'src="/images/$1"')
    .replace(/srcset="[^"]*"/g, '')                    // simplify
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .replace(/> </g, '><')
    .trim();
}
function stripTags(html) {
  return String(html).replace(/<[^>]+>/g,' ').replace(/&[a-z]+;/gi,' ').replace(/\s+/g,' ').trim();
}
function cleanTitle(title) {
  return String(title || '').replace(/&#8211;|&ndash;/g, '–').replace(/\s*[\|\-–]\s*Melbourne[^<]*$/i, '').trim();
}

/* ── copy images to public/images ────────────────────── */
function copyImages() {
  if (!fs.existsSync(IMG_DIR)) return 0;
  fs.mkdirSync(PUBLIC_IMG, { recursive: true });
  let n = 0;
  fs.readdirSync(IMG_DIR).forEach(f => {
    const src = path.join(IMG_DIR, f);
    const dst = path.join(PUBLIC_IMG, f);
    if (!fs.existsSync(dst)) { fs.copyFileSync(src, dst); n++; }
  });
  return n;
}

/* ── import pages ────────────────────────────────────── */
function importPages() {
  const insert = db.prepare(`
    INSERT INTO pages (slug, title, nav_group, nav_order, is_published, is_members_only, body_html, body_text, source_url)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET title=excluded.title, nav_group=excluded.nav_group, nav_order=excluded.nav_order,
      is_members_only=excluded.is_members_only, body_html=excluded.body_html, body_text=excluded.body_text, source_url=excluded.source_url, updated_at=datetime('now')
  `);
  if (!fs.existsSync(PAGES_DIR)) return 0;
  const files = fs.readdirSync(PAGES_DIR).filter(f => f.endsWith('.json'));
  let n = 0;
  const tx = db.transaction(() => {
    for (const f of files) {
      const d = JSON.parse(fs.readFileSync(path.join(PAGES_DIR, f), 'utf8'));
      const slug = d.slug;
      const cls = classifySlug(slug);
      if (!cls) continue;  // skip home/mainpage
      insert.run(
        slug,
        cleanTitle(d.title) || slug.replace(/-/g, ' '),
        cls.nav_group,
        cls.order,
        cls.members_only,
        cleanBody(d.html_main, d.url),
        d.text || stripTags(d.html_main || ''),
        d.url,
      );
      n++;
    }
  });
  tx();
  return n;
}

/* ── import posts ────────────────────────────────────── */
function importPosts() {
  const insert = db.prepare(`
    INSERT INTO posts (slug, title, body_html, body_text, excerpt, published_at, is_published, source_url)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(slug) DO UPDATE SET title=excluded.title, body_html=excluded.body_html, body_text=excluded.body_text,
      excerpt=excluded.excerpt, published_at=excluded.published_at, source_url=excluded.source_url
  `);
  if (!fs.existsSync(POSTS_DIR)) return 0;
  const files = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.json'));
  let n = 0;
  const tx = db.transaction(() => {
    for (const f of files) {
      const d = JSON.parse(fs.readFileSync(path.join(POSTS_DIR, f), 'utf8'));
      // Extract date from slug if present (e.g. 2023-05-25-...)
      const dateMatch = d.slug.match(/^(\d{4})-(\d{2})-(\d{2})/);
      const publishedAt = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : null;
      const text = d.text || stripTags(d.html_main || '');
      insert.run(
        d.slug,
        cleanTitle(d.title) || d.slug.replace(/-/g, ' '),
        cleanBody(d.html_main, d.url),
        text,
        text.slice(0, 200),
        publishedAt,
        d.url,
      );
      n++;
    }
  });
  tx();
  return n;
}

(function main() {
  const t0 = Date.now();
  const imgCount  = copyImages();
  const pageCount = importPages();
  const postCount = importPosts();
  console.log(`\n=== IMPORT COMPLETE ===`);
  console.log(`  Images copied: ${imgCount}`);
  console.log(`  Pages imported: ${pageCount}`);
  console.log(`  Posts imported: ${postCount}`);
  console.log(`  Took: ${Math.round((Date.now() - t0)/1000)}s`);
})();
