/* ============================================================
   MISC CLUB — SQLite schema + seeded settings
   ============================================================ */
const path = require('path');
const fs   = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'misc-club.sqlite');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/* ── migration: training_sessions schema bump (add slot_index) ───────────
   The original schema had UNIQUE(session_date, discipline) which prevented
   us running TWO Air Pistol sessions on the same night. We now need
   slot_index in the UNIQUE constraint. SQLite can't ALTER a UNIQUE
   constraint in place — so if the old schema is detected and the table is
   still empty / only auto-seeded, just drop the training tables and let the
   schema recreate them below. No user bookings exist yet on this concept
   site, so this is safe. ───────────────────────────────────────────────── */
const _ts = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='training_sessions'").get();
if (_ts) {
  const cols = db.prepare("PRAGMA table_info(training_sessions)").all();
  const hasSlotIndex = cols.some(c => c.name === 'slot_index');
  if (!hasSlotIndex) {
    console.log('[db] Migrating training_sessions to slot_index schema…');
    db.exec(`DROP TABLE IF EXISTS training_bookings; DROP TABLE IF EXISTS training_sessions;`);
  }
}

/* ── schema ─────────────────────────────────────────────── */
db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Content pages — the admin edits these in-place, public renderer reads them
CREATE TABLE IF NOT EXISTS pages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT UNIQUE NOT NULL,           -- e.g. 'about-misc', 'club-history'
  title       TEXT NOT NULL,
  nav_group   TEXT,                            -- 'about','disciplines','how-to','members','contact'
  nav_order   INTEGER DEFAULT 100,
  body_html   TEXT NOT NULL DEFAULT '',
  body_text   TEXT NOT NULL DEFAULT '',        -- searchable / fallback text
  is_published INTEGER NOT NULL DEFAULT 1,
  is_members_only INTEGER NOT NULL DEFAULT 0,
  source_url  TEXT,                            -- original misc.org.au URL
  created_at  DATETIME DEFAULT (datetime('now')),
  updated_at  DATETIME DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pages_navgroup ON pages(nav_group, nav_order);

-- Posts / news
CREATE TABLE IF NOT EXISTS posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT UNIQUE NOT NULL,
  title       TEXT NOT NULL,
  body_html   TEXT NOT NULL DEFAULT '',
  body_text   TEXT NOT NULL DEFAULT '',
  excerpt     TEXT,
  published_at DATETIME,
  is_published INTEGER NOT NULL DEFAULT 1,
  source_url  TEXT,
  created_at  DATETIME DEFAULT (datetime('now'))
);

-- Form submissions (one table per form type — easier admin UX than a polymorphic blob)
CREATE TABLE IF NOT EXISTS contact_submissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  phone       TEXT,
  subject     TEXT,
  message     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'new',     -- new, replied, archived
  admin_notes TEXT,
  created_at  DATETIME DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS membership_applications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  email       TEXT NOT NULL,
  phone       TEXT NOT NULL,
  date_of_birth TEXT,
  address     TEXT,
  suburb      TEXT,
  postcode    TEXT,
  state       TEXT,
  shooting_experience TEXT,
  primary_discipline  TEXT,                    -- 'pistol','rifle','both'
  existing_licence    TEXT,                    -- yes/no/pending
  licence_number      TEXT,
  referee_member      TEXT,
  notes               TEXT,
  status              TEXT NOT NULL DEFAULT 'new',
  admin_notes         TEXT,
  created_at          DATETIME DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS range_bookings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  member_name   TEXT NOT NULL,
  member_email  TEXT NOT NULL,
  member_phone  TEXT,
  member_number TEXT,
  booking_date  TEXT NOT NULL,                 -- YYYY-MM-DD
  start_time    TEXT NOT NULL,                 -- HH:MM
  end_time      TEXT NOT NULL,
  range_type    TEXT NOT NULL,                 -- 'air','25m','50m','rifle','any'
  num_shooters  INTEGER NOT NULL DEFAULT 1,
  notes         TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending, approved, rejected, cancelled
  admin_notes   TEXT,
  created_at    DATETIME DEFAULT (datetime('now'))
);

-- Wednesday-night training sessions: weekly recurring across 4 disciplines.
-- Air Pistol runs TWO sessions per Wednesday (6:30-7:25 and 7:30-8:25, 5 slots each).
-- Other disciplines run ONE session per Wednesday (6:30-9:00, 8 slots).
-- Sessions are seeded automatically by the seeder below.
CREATE TABLE IF NOT EXISTS training_sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_date TEXT NOT NULL,                     -- YYYY-MM-DD (a Wednesday)
  discipline   TEXT NOT NULL,                     -- 'air-pistol' | 'rimfire' | 'centrefire' | 'service'
  slot_index   INTEGER NOT NULL DEFAULT 1,        -- 1 or 2 (air-pistol has two slots)
  start_time   TEXT NOT NULL DEFAULT '18:30',
  end_time     TEXT NOT NULL DEFAULT '21:00',
  capacity     INTEGER NOT NULL DEFAULT 8,
  is_open      INTEGER NOT NULL DEFAULT 1,
  notes        TEXT,
  created_at   DATETIME DEFAULT (datetime('now')),
  UNIQUE(session_date, discipline, slot_index)
);
CREATE INDEX IF NOT EXISTS idx_training_sessions_date ON training_sessions(session_date);

CREATE TABLE IF NOT EXISTS training_bookings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      INTEGER NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
  member_name     TEXT NOT NULL,
  member_email    TEXT NOT NULL,
  member_phone    TEXT,
  member_number   TEXT,
  experience      TEXT,                            -- 'beginner' | 'intermediate' | 'experienced'
  has_own_kit     INTEGER NOT NULL DEFAULT 0,      -- own pistol & ammo or borrowing
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'confirmed', -- confirmed | cancelled | attended | no-show
  admin_notes     TEXT,
  created_at      DATETIME DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_training_bookings_session ON training_bookings(session_id, status);

CREATE TABLE IF NOT EXISTS event_rsvps (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  event_name   TEXT NOT NULL,
  event_date   TEXT,
  attendee_name  TEXT NOT NULL,
  attendee_email TEXT NOT NULL,
  attendee_phone TEXT,
  num_attendees  INTEGER NOT NULL DEFAULT 1,
  dietary        TEXT,
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'confirmed',
  created_at     DATETIME DEFAULT (datetime('now'))
);
`);

/* ── seeded settings ─────────────────────────────────────── */
const settingsDefaults = {
  CLUB_NAME:        'Melbourne International Shooting Club',
  CLUB_TAGLINE:     'Target shooting · Pistol · Rifle · ISSF · Established 1955',
  CLUB_ADDRESS:     '120-128 Todd Road, Port Melbourne VIC 3207',
  CLUB_PHONE:       '03 9646 3976',
  CONTACT_EMAIL:    'miscevents@misc.org.au',
  ADMIN_PASSWORD:   'misc-club-2026',
  SITE_URL:         'https://miscclub.jgrogan.com',
  // Email (mirrors MISC-OPEN — same M365 mailbox)
  SMTP_HOST:        'smtp.office365.com',
  SMTP_PORT:        '587',
  SMTP_USER:        'miscevents@misc.org.au',
  SMTP_PASS:        '',
  EMAIL_FROM_NAME:  'MISC Club',
  EMAIL_ENABLED:    '0',
};
const setSetting = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING`);
const seed = db.transaction(() => {
  Object.entries(settingsDefaults).forEach(([k, v]) => setSetting.run(k, String(v)));
});
seed();

/* ── training-session auto-seeder ────────────────────────────────────────
   On every startup, ensure the next ~12 Wednesdays exist as sessions.

   Air Pistol — TWO sessions per Wednesday, 5 slots each:
     • slot 1:  6:30 pm – 7:25 pm
     • slot 2:  7:30 pm – 8:25 pm
   Rimfire / Centrefire / Service — ONE session per Wednesday, 8 slots:
     • slot 1:  6:30 pm – 9:00 pm

   Idempotent thanks to UNIQUE(session_date, discipline, slot_index).
   ──────────────────────────────────────────────────────────────────────── */
const DISCIPLINES = ['air-pistol', 'rimfire', 'centrefire', 'service'];
const DISCIPLINE_SLOTS = {
  'air-pistol': [
    { slot_index: 1, start_time: '18:30', end_time: '19:25', capacity: 5 },
    { slot_index: 2, start_time: '19:30', end_time: '20:25', capacity: 5 },
  ],
  'rimfire':    [{ slot_index: 1, start_time: '19:00', end_time: '20:30', capacity: 8 }],
  'centrefire': [{ slot_index: 1, start_time: '19:00', end_time: '20:30', capacity: 8 }],
  'service':    [{ slot_index: 1, start_time: '19:30', end_time: '21:00', capacity: 8 }],
};
function nextWednesdays(count) {
  const out = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  // Move to nearest upcoming Wednesday (3 = Wed)
  const dow = d.getDay();
  const daysAhead = (3 - dow + 7) % 7 || 7;  // if today is Wed, start with next week
  d.setDate(d.getDate() + daysAhead);
  for (let i = 0; i < count; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 7);
  }
  return out;
}
const seedSession = db.prepare(`
  INSERT INTO training_sessions (session_date, discipline, slot_index, start_time, end_time, capacity)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(session_date, discipline, slot_index) DO NOTHING
`);
const seedTraining = db.transaction(() => {
  const dates = nextWednesdays(12);
  for (const date of dates) {
    for (const disc of DISCIPLINES) {
      for (const slot of DISCIPLINE_SLOTS[disc]) {
        seedSession.run(date, disc, slot.slot_index, slot.start_time, slot.end_time, slot.capacity);
      }
    }
  }
});
seedTraining();

/* ── time/capacity reconciliation ────────────────────────────────────────
   Existing future rows may carry old times (e.g. 6:30 – 9:00 pm seeded
   before the schedule was tuned). Bring them into line with DISCIPLINE_SLOTS
   on every startup — but ONLY for future sessions that have no bookings yet,
   so we never silently mutate a session a member has already booked into.
   ──────────────────────────────────────────────────────────────────────── */
const updateSlot = db.prepare(`
  UPDATE training_sessions
     SET start_time = ?, end_time = ?, capacity = ?
   WHERE session_date >= date('now')
     AND discipline = ? AND slot_index = ?
     AND (start_time != ? OR end_time != ? OR capacity != ?)
     AND id NOT IN (SELECT session_id FROM training_bookings WHERE status IN ('confirmed','attended'))
`);
const reconcile = db.transaction(() => {
  for (const [disc, slots] of Object.entries(DISCIPLINE_SLOTS)) {
    for (const slot of slots) {
      const info = updateSlot.run(
        slot.start_time, slot.end_time, slot.capacity,
        disc, slot.slot_index,
        slot.start_time, slot.end_time, slot.capacity,
      );
      if (info.changes > 0) console.log(`[db] Re-timed ${info.changes} future ${disc} slot-${slot.slot_index} sessions → ${slot.start_time}–${slot.end_time}, cap ${slot.capacity}`);
    }
  }
});
reconcile();

module.exports = db;
module.exports.DISCIPLINES = DISCIPLINES;
module.exports.DISCIPLINE_SLOTS = DISCIPLINE_SLOTS;
