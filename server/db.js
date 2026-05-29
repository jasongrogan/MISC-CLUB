/* ============================================================
   MISC CLUB — SQLite schema + seeded settings
   ============================================================ */
const path = require('path');
const fs   = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'documents'), { recursive: true });
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

-- Members directory — synced from Sight Picture + local-only profile fields
CREATE TABLE IF NOT EXISTS members (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  member_number        TEXT UNIQUE NOT NULL,             -- Sight Picture memberId, e.g. "1530"
  first_name           TEXT,
  last_name            TEXT,
  display_name         TEXT NOT NULL,                    -- raw name from SP, e.g. "PETER KELLY"
  email                TEXT,
  -- Sight Picture cross-ref
  sp_user_id           TEXT,                             -- userId, e.g. "Mship1530"
  sp_access_roles      TEXT,                             -- JSON: ["Shooter","Trainer"]
  sp_synced_at         DATETIME,
  -- Local-only profile fields (members edit these themselves)
  vapa_id              TEXT,
  trv_id               TEXT,
  pistol_licence       TEXT,                             -- handgun licence # ("H" licences)
  pistol_licence_expiry TEXT,                            -- YYYY-MM-DD
  rifle_licence        TEXT,                             -- long-arm licence #
  rifle_licence_expiry TEXT,                             -- YYYY-MM-DD
  -- Auth
  password_hash        TEXT,
  password_salt        TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  last_login           DATETIME,
  is_active            INTEGER NOT NULL DEFAULT 1,
  created_at           DATETIME DEFAULT (datetime('now')),
  updated_at           DATETIME DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_members_email ON members(email);

-- Cached competition scores pulled from Sight Picture
CREATE TABLE IF NOT EXISTS member_scores (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id     INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  match_id      TEXT NOT NULL,                           -- composite matchDetails string
  match_name    TEXT,                                    -- "Combined Services"
  match_date    TEXT,                                    -- YYYY-MM-DD extracted from matchDetails
  detail        TEXT,                                    -- detail number
  firearm_class TEXT,
  sub_class     TEXT,
  calibre       TEXT,
  grade         TEXT,
  range_name    TEXT,
  is_comp       INTEGER NOT NULL DEFAULT 1,              -- competition vs practice
  score         INTEGER NOT NULL,
  synced_at     DATETIME DEFAULT (datetime('now')),
  UNIQUE(member_id, match_id)
);
CREATE INDEX IF NOT EXISTS idx_member_scores_date ON member_scores(member_id, match_date DESC);

-- Member login sessions (DB-backed so restarts don't kick everyone out)
CREATE TABLE IF NOT EXISTS member_sessions (
  token       TEXT PRIMARY KEY,
  member_id   INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  expires_at  DATETIME NOT NULL,
  created_at  DATETIME DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_member_sessions_member ON member_sessions(member_id);

-- Documents library — members-only (bylaws, minutes, policies, forms)
CREATE TABLE IF NOT EXISTS documents (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL,
  slug            TEXT UNIQUE NOT NULL,
  category        TEXT NOT NULL,                         -- bylaws | minutes | policies | forms | annual-reports
  description     TEXT,
  file_path       TEXT,                                  -- relative under data/documents/
  file_name       TEXT,                                  -- original filename for download
  mime_type       TEXT,
  size_bytes      INTEGER,
  is_members_only INTEGER NOT NULL DEFAULT 1,
  uploaded_at     DATETIME DEFAULT (datetime('now')),
  uploaded_by     TEXT
);
CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category);

-- Club calendar events — managed via admin, displayed on /calendar
CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  event_date   TEXT NOT NULL,          -- YYYY-MM-DD (start date)
  end_date     TEXT,                   -- YYYY-MM-DD for multi-day events
  start_time   TEXT,                   -- HH:MM (optional)
  end_time     TEXT,                   -- HH:MM (optional)
  category     TEXT NOT NULL DEFAULT 'club',  -- club | competition | training | social | external
  description  TEXT,
  location     TEXT DEFAULT '120–128 Todd Road, Port Melbourne',
  external_url TEXT,
  is_published INTEGER NOT NULL DEFAULT 1,
  created_at   DATETIME DEFAULT (datetime('now')),
  UNIQUE(title, event_date)
);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
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
  // Sight Picture API (M2M OAuth client-credentials flow)
  SP_CLIENT_ID:     '22c5h867g7qlh4eesqjpb4dovj',
  SP_CLIENT_SECRET: 'a30eo314ebrgab4pdvmm3v2nqkrgc26qesr2j7onfl9159dvddk',
  SP_API_URL:       'https://rwwejhz1i8.execute-api.ap-southeast-2.amazonaws.com',
  SP_AUTH_URL:      'https://shootscore.auth.ap-southeast-2.amazoncognito.com/oauth2/token',
  SP_CLUB_ID:       'MISC',
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

/* ── events seed data ─────────────────────────────────────────────────────
   Idempotent thanks to UNIQUE(title, event_date) + ON CONFLICT DO NOTHING.
   Seeded on every startup so a fresh DB immediately has a useful calendar.
   ──────────────────────────────────────────────────────────────────────── */
const seedEvent = db.prepare(`
  INSERT INTO events (title, event_date, end_date, start_time, end_time, category, description, location, external_url)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(title, event_date) DO NOTHING
`);
const seedEvents = db.transaction(() => {
  const LOC  = '120–128 Todd Road, Port Melbourne';
  const MISC = 'https://misc.org.au';
  const ev = [
    // ── 2026 ───────────────────────────────────────────
    ['Club Pistol Championship — June',           '2026-06-06', null,         '08:30','13:00','competition','Monthly club pistol championship. Open to all financial MISC pistol members. Full ISSF programme.',LOC,null],
    ['Interclub Match — MISC vs SASC',            '2026-06-27', null,         '09:00','14:00','competition','Friendly interclub pistol match. All disciplines welcome.',LOC,null],
    ['Club Pistol Championship — July',           '2026-07-04', null,         '08:30','13:00','competition','Monthly club pistol championship. Open to all financial MISC pistol members.',LOC,null],
    ['Club Rifle Championship — July',            '2026-07-11', null,         '09:00','13:00','competition','Monthly club rifle championship — Prone, Bench Rest, Positional.',LOC,null],
    ['Club Pistol Championship — August',         '2026-08-01', null,         '08:30','13:00','competition','Monthly club pistol championship.',LOC,null],
    ['MISC Club AGM',                             '2026-08-17', null,         '19:00','21:00','club',       'Annual General Meeting — all members welcome and encouraged to attend.',LOC,null],
    ['Club Pistol Championship — September',      '2026-09-05', null,         '08:30','13:00','competition','Monthly club pistol championship.',LOC,null],
    ['Victorian State Pistol Championships',      '2026-09-19', '2026-09-20', '08:00','17:00','competition','Two-day State Pistol Championships — ISSF disciplines. MISC members competing.',LOC,MISC],
    ['Club Pistol Championship — October',        '2026-10-03', null,         '08:30','13:00','competition','Monthly club pistol championship.',LOC,null],
    ['WA1500 Charity Shoot',                      '2026-10-17', null,         '09:00','14:00','competition','Annual WA1500 revolver charity shoot — entry by donation. All welcome.',LOC,null],
    ['Club Pistol Championship — November',       '2026-11-07', null,         '08:30','13:00','competition','Monthly club pistol championship.',LOC,null],
    ['MISC Open — 2026',                          '2026-11-21', '2026-11-22', '08:00','17:00','competition','The Melbourne International Shooting Club Open. Two-day ISSF pistol & rifle competition.',LOC,'https://miscopen.jgrogan.com'],
    ['Club Pistol Championship — December',       '2026-12-05', null,         '08:30','13:00','competition','Monthly club pistol championship — final shoot of the year.',LOC,null],
    ['End of Year Social Shoot & BBQ',            '2026-12-13', null,         '09:00','14:00','social',     'Casual year-end social shoot followed by a club BBQ. Bring the family.',LOC,null],
    // ── 2027 ───────────────────────────────────────────
    ['Club Pistol Championship — January',        '2027-01-10', null,         '08:30','13:00','competition','Monthly club pistol championship.',LOC,null],
    ['Summer Interclub Match',                    '2027-01-24', null,         '09:00','14:00','competition','Interclub pistol match — hosted at MISC.',LOC,null],
    ['Club Pistol Championship — February',       '2027-02-07', null,         '08:30','13:00','competition','Monthly club pistol championship.',LOC,null],
    ['Victorian Postal Air Pistol',               '2027-02-20', '2027-02-21', '09:00','15:00','competition','State postal air pistol competition — scores submitted electronically. ISSF 10m.',LOC,MISC],
    ['Club Pistol Championship — March',          '2027-03-07', null,         '08:30','13:00','competition','Monthly club pistol championship.',LOC,null],
    ['Club Rifle Championship — March',           '2027-03-21', null,         '09:00','13:00','competition','Quarterly club rifle championship.',LOC,null],
    ['Club Pistol Championship — April',          '2027-04-05', null,         '08:30','13:00','competition','Monthly club pistol championship.',LOC,null],
    ['ANZAC Day Memorial Shoot',                  '2027-04-25', null,         '10:00','13:00','club',       'Annual ANZAC Day memorial shoot. A solemn and proud club tradition since 1957.',LOC,null],
    ['Club Pistol Championship — May',            '2027-05-03', null,         '08:30','13:00','competition','Monthly club pistol championship.',LOC,null],
    ['MISC Open 2027',                            '2027-05-14', '2027-05-17', '08:00','17:00','competition','The MISC Open 2027 — flagship four-day ISSF pistol & rifle event. Registration open.',LOC,'https://miscopen.jgrogan.com'],
  ];
  ev.forEach(r => seedEvent.run(...r));
});
seedEvents();

module.exports = db;
module.exports.DISCIPLINES = DISCIPLINES;
module.exports.DISCIPLINE_SLOTS = DISCIPLINE_SLOTS;
