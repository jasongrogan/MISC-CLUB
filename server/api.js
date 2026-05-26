/* ============================================================
   MISC CLUB — Public API: form submissions + HTML form pages
   ============================================================ */
const express = require('express');
const path    = require('path');
const db      = require('./db');

const router = express.Router();

function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

/* ── shared form-page renderer ─────────────────────────── */
function renderFormShell(title, bodyHtml) {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${esc(title)} — MISC</title>
<link rel="icon" href="/images/MISC-Colour-6x-1-300x294.png"/>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800;900&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet"/>
<link rel="stylesheet" href="/css/styles.css"/></head>
<body class="page-wrap"><header class="site-header">
  <div class="brand"><a href="/"><strong>MISC</strong></a></div>
  <nav class="main-nav">
    <a href="/">Home</a><a href="/forms/contact">Contact</a><a href="/forms/join">Join</a>
    <a href="/forms/training">Training</a>
  </nav></header>
<main class="form-page">${bodyHtml}</main>
<footer class="site-footer"><div class="container footer-bar"><p>&copy; 2026 Melbourne International Shooting Club</p></div></footer></body></html>`;
}

/* ── 1. Contact form ───────────────────────────────────── */
router.get('/forms/contact', (_req, res) => res.send(renderFormShell('Contact us', `
  <h1>Contact us</h1>
  <p>Questions, feedback or general enquiries — drop us a line and the committee will respond.</p>
  <form method="POST" action="/forms/contact" class="form">
    <label>Name *<input name="name" required maxlength="120"/></label>
    <label>Email *<input name="email" type="email" required maxlength="200"/></label>
    <label>Phone<input name="phone" type="tel" maxlength="40"/></label>
    <label>Subject<input name="subject" maxlength="200"/></label>
    <label>Message *<textarea name="message" rows="6" required maxlength="4000"></textarea></label>
    <button type="submit" class="btn">Send message</button>
  </form>`)));

router.post('/forms/contact', (req, res) => {
  const { name, email, phone, subject, message } = req.body || {};
  if (!name || !email || !message) return res.status(400).send(renderFormShell('Error', '<h1>Missing fields</h1><p>Name, email and message are required. <a href="/forms/contact">Try again</a></p>'));
  db.prepare(`INSERT INTO contact_submissions (name,email,phone,subject,message) VALUES (?,?,?,?,?)`)
    .run(String(name).trim(), String(email).trim(), phone?String(phone).trim():null, subject?String(subject).trim():null, String(message).trim());
  res.send(renderFormShell('Thanks!', '<h1>Thanks — we got it.</h1><p>The MISC committee will reply within a few business days. <a href="/">Back to home</a></p>'));
});

/* ── 2. Membership application ─────────────────────────── */
router.get('/forms/join', (_req, res) => res.send(renderFormShell('Join MISC', `
  <h1>Apply for MISC membership</h1>
  <p>Fill in your details and the committee will be in touch. Existing pistol/firearms licence not required to apply.</p>
  <form method="POST" action="/forms/join" class="form">
    <div class="row">
      <label>First name *<input name="first_name" required maxlength="80"/></label>
      <label>Last name *<input name="last_name" required maxlength="80"/></label>
    </div>
    <div class="row">
      <label>Email *<input name="email" type="email" required maxlength="200"/></label>
      <label>Phone *<input name="phone" type="tel" required maxlength="40"/></label>
    </div>
    <label>Date of birth<input name="date_of_birth" type="date"/></label>
    <label>Street address<input name="address" maxlength="200"/></label>
    <div class="row">
      <label>Suburb<input name="suburb" maxlength="80"/></label>
      <label>State<select name="state"><option value="">--</option><option>VIC</option><option>NSW</option><option>QLD</option><option>SA</option><option>WA</option><option>TAS</option><option>NT</option><option>ACT</option></select></label>
      <label>Postcode<input name="postcode" maxlength="10"/></label>
    </div>
    <label>Shooting experience<textarea name="shooting_experience" rows="3" maxlength="2000" placeholder="Any prior club membership, competitions, etc."></textarea></label>
    <label>Primary discipline<select name="primary_discipline"><option value="">--</option><option>Pistol</option><option>Rifle</option><option>Both</option><option>Unsure</option></select></label>
    <label>Existing firearms / pistol licence?<select name="existing_licence"><option value="">--</option><option>Yes</option><option>No</option><option>In progress</option></select></label>
    <label>Licence number (if any)<input name="licence_number" maxlength="80"/></label>
    <label>Referee — existing MISC member (if any)<input name="referee_member" maxlength="120"/></label>
    <label>Notes<textarea name="notes" rows="3" maxlength="2000"></textarea></label>
    <button type="submit" class="btn">Submit application</button>
  </form>`)));

router.post('/forms/join', (req, res) => {
  const f = req.body || {};
  if (!f.first_name || !f.last_name || !f.email || !f.phone) return res.status(400).send(renderFormShell('Error', '<h1>Missing fields</h1><p>First name, last name, email and phone are required. <a href="/forms/join">Try again</a></p>'));
  db.prepare(`INSERT INTO membership_applications (first_name,last_name,email,phone,date_of_birth,address,suburb,postcode,state,shooting_experience,primary_discipline,existing_licence,licence_number,referee_member,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(String(f.first_name).trim(), String(f.last_name).trim(), String(f.email).trim(), String(f.phone).trim(),
         f.date_of_birth||null, f.address||null, f.suburb||null, f.postcode||null, f.state||null,
         f.shooting_experience||null, f.primary_discipline||null, f.existing_licence||null,
         f.licence_number||null, f.referee_member||null, f.notes||null);
  res.send(renderFormShell('Application received', '<h1>Application received — thanks!</h1><p>The membership committee will review your application and be in touch shortly. <a href="/">Back to home</a></p>'));
});

/* ── 3. Wednesday-night training booking ───────────────────────────────
   Weekly Wednesday training sessions across 4 disciplines:
     • Air Pistol fundamentals
     • Rimfire fundamentals (.22 LR)
     • Centrefire fundamentals
     • Service Range fundamentals
   Each session has a capacity (default 8). Sessions are auto-seeded for the
   next ~12 Wednesdays in db.js.
   ──────────────────────────────────────────────────────────────────────── */

const DISCIPLINE_META = {
  'air-pistol': { label: '10m Air Pistol',  blurb: 'Olympic ISSF discipline · indoor air range · electronic targets',  icon: '⌖' },
  'rimfire':    { label: 'Rimfire (.22 LR)', blurb: '25m precision · ideal for new pistol shooters · borrow club kit', icon: '⌾' },
  'centrefire': { label: 'Centrefire',       blurb: '25m programme · larger calibres · standard & rapid disciplines',  icon: '⌬' },
  'service':    { label: 'Service Range',    blurb: 'Fundamentals — Training Plan · Service Match · Unrestricted Service 25', icon: '▣' },
};

/* ── booking policy ─────────────────────────────────────────────────────
   BOOKING_WINDOW_DAYS  — how far ahead a member may book (rolling).
   MAX_ACTIVE_BOOKINGS  — cap on simultaneous confirmed bookings per email,
                          so one member can't sweep every Wednesday slot.
   Sessions beyond the window are still displayed as "Opens DD MMM" so
   members see what's coming but can't grab a card until it's in range.
   ──────────────────────────────────────────────────────────────────────── */
const BOOKING_WINDOW_DAYS = 14;
const MAX_ACTIVE_BOOKINGS = 4;

function disciplineLabel(slug) { return DISCIPLINE_META[slug]?.label || slug; }
function fmtSessionDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtShortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}
/** True if a session is currently bookable (date within rolling window). */
function isInBookingWindow(sessionDate) {
  if (!sessionDate) return false;
  const today = new Date(); today.setHours(0,0,0,0);
  const sd    = new Date(sessionDate + 'T00:00:00');
  const days  = Math.floor((sd - today) / 86400000);
  return days >= 0 && days <= BOOKING_WINDOW_DAYS;
}
/** Count active (future, confirmed) bookings for a member email. */
function countActiveBookings(email) {
  if (!email) return 0;
  return db.prepare(`
    SELECT COUNT(*) AS n FROM training_bookings b
     JOIN training_sessions s ON s.id = b.session_id
    WHERE LOWER(b.member_email) = LOWER(?) AND b.status = 'confirmed' AND s.session_date >= date('now')
  `).get(String(email).trim()).n;
}
/** Date a preview session becomes bookable — i.e. session_date - BOOKING_WINDOW_DAYS. */
function opensOn(sessionDate) {
  if (!sessionDate) return '';
  const d = new Date(sessionDate + 'T00:00:00');
  d.setDate(d.getDate() - BOOKING_WINDOW_DAYS);
  return d.toISOString().slice(0, 10);
}

router.get('/forms/training', (req, res) => {
  const filterDiscipline = String(req.query.discipline || '').trim();

  // Pull upcoming sessions with booking counts (next ~12 Wednesdays × disciplines × slots)
  const rows = db.prepare(`
    SELECT s.id, s.session_date, s.discipline, s.slot_index, s.start_time, s.end_time, s.capacity, s.is_open,
           (SELECT COUNT(*) FROM training_bookings b WHERE b.session_id = s.id AND b.status IN ('confirmed','attended')) AS booked
      FROM training_sessions s
     WHERE s.session_date >= date('now')
       ${filterDiscipline ? "AND s.discipline = ?" : ''}
     ORDER BY s.session_date, s.discipline, s.slot_index
     LIMIT 120
  `).all(...(filterDiscipline ? [filterDiscipline] : []));

  // Group by date for tidy display
  const byDate = {};
  rows.forEach(r => { (byDate[r.session_date] = byDate[r.session_date] || []).push(r); });

  const disciplineFilterTabs = `
    <div class="discipline-filter">
      <a href="/forms/training" class="${!filterDiscipline ? 'active' : ''}">All disciplines</a>
      ${Object.entries(DISCIPLINE_META).map(([slug, m]) =>
        `<a href="/forms/training?discipline=${slug}" class="${filterDiscipline===slug?'active':''}"><span>${m.icon}</span> ${esc(m.label)}</a>`
      ).join('')}
    </div>`;

  // Format a friendly time range (e.g. "6:30 – 7:25 pm")
  const fmtTime = (s) => {
    const [hh, mm] = s.split(':');
    const h = parseInt(hh, 10);
    const h12 = ((h + 11) % 12) + 1;
    return `${h12}:${mm}${h >= 12 ? 'pm' : 'am'}`;
  };

  const sessionList = Object.entries(byDate).map(([date, sessions]) => {
    const inWindow = isInBookingWindow(date);
    return `
    <div class="session-day ${inWindow ? '' : 'preview'}">
      <h3 class="session-date">${esc(fmtSessionDate(date))}${inWindow ? '' : `<span class="opens-badge">Opens ${esc(fmtShortDate(opensOn(date)))}</span>`}</h3>
      <div class="session-grid">
        ${sessions.map(s => {
          const remaining = Math.max(0, s.capacity - s.booked);
          const isFull = remaining === 0;
          const meta = DISCIPLINE_META[s.discipline] || { label: s.discipline, blurb: '', icon: '•' };
          // Distinguish the two air-pistol time slots in the label
          const slotSuffix = (s.discipline === 'air-pistol' && s.slot_index === 2) ? ' · Late' : (s.discipline === 'air-pistol' ? ' · Early' : '');
          let btn;
          if (!inWindow)      btn = `<button class="btn-sess" disabled>Opens ${esc(fmtShortDate(opensOn(date)))}</button>`;
          else if (isFull)    btn = '<button class="btn-sess" disabled>Session full</button>';
          else                btn = `<a href="/forms/training/book/${s.id}" class="btn-sess">Book this session →</a>`;
          return `
            <div class="session-card ${isFull ? 'full' : ''} ${inWindow ? '' : 'preview'}">
              <div class="session-icon">${meta.icon}</div>
              <div class="session-card-time">${esc(fmtTime(s.start_time))} – ${esc(fmtTime(s.end_time))}</div>
              <h4>${esc(meta.label)}${esc(slotSuffix)}</h4>
              <p>${esc(meta.blurb)}</p>
              <div class="session-meta">
                <span class="cap-pill ${isFull?'cap-full':remaining<=2?'cap-low':'cap-ok'}">${isFull?'Full':`${remaining}/${s.capacity} spots`}</span>
              </div>
              ${btn}
            </div>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');

  res.send(renderFormShell('Wednesday Training', `
    <div class="members-banner">
      <span class="mb-icon">🔒</span>
      <div>
        <strong>MISC members only.</strong>
        <span>Wednesday training sessions are reserved for current MISC members. Not a member yet? <a href="/forms/join">Apply to join →</a></span>
      </div>
    </div>
    <div class="training-intro">
      <span class="section-eyebrow gold-text">Wednesday-night fundamentals</span>
      <h1>Training Sessions</h1>
      <p style="color:var(--muted);font-size:1.05rem;max-width:64ch">
        Every Wednesday night the club runs coached fundamentals training across four pistol disciplines.
      </p>
      <ul class="training-times">
        <li><strong>10m Air Pistol</strong> · two sessions: <span class="t-time">6:30 – 7:25 pm</span> &amp; <span class="t-time">7:30 – 8:25 pm</span> · 5 slots each</li>
        <li><strong>Rimfire &amp; Centrefire</strong> · <span class="t-time">7:00 – 8:30 pm</span> · 8 slots each</li>
        <li><strong>Service Range</strong> — Fundamentals · Training Plan · <span class="t-time">7:30 – 9:00 pm</span> · 8 slots</li>
      </ul>
      <div class="policy-note">
        <span class="pn-icon">ⓘ</span>
        <span>Bookings open <strong style="color:var(--text)">${BOOKING_WINDOW_DAYS} days</strong> ahead — sessions further out show as <em>Opens DD MMM</em> so you can plan ahead, but the slot frees up each week so everyone gets a fair go. Maximum <strong style="color:var(--text)">${MAX_ACTIVE_BOOKINGS}</strong> active bookings per member at a time.</span>
      </div>
    </div>
    ${disciplineFilterTabs}
    ${rows.length === 0
      ? '<div class="empty-state"><p>No upcoming sessions match that filter — try "All disciplines".</p></div>'
      : sessionList}
  `));
});

// Booking form for a specific session
router.get('/forms/training/book/:sessionId', (req, res) => {
  const s = db.prepare(`
    SELECT s.*, (SELECT COUNT(*) FROM training_bookings b WHERE b.session_id = s.id AND b.status IN ('confirmed','attended')) AS booked
      FROM training_sessions s WHERE s.id = ?
  `).get(req.params.sessionId);
  if (!s) return res.status(404).send(renderFormShell('Not found', '<h1>Session not found</h1><p><a href="/forms/training">Back to sessions</a></p>'));
  const meta = DISCIPLINE_META[s.discipline] || { label: s.discipline };
  // Window check — sessions outside the rolling booking window are preview-only
  if (!isInBookingWindow(s.session_date)) {
    return res.status(403).send(renderFormShell('Not yet bookable', `
      <div class="members-banner">
        <span class="mb-icon">🗓️</span>
        <div>
          <strong>Bookings open ${esc(fmtShortDate(opensOn(s.session_date)))}</strong>
          <span>This session is more than ${BOOKING_WINDOW_DAYS} days away. Bookings open on a rolling ${BOOKING_WINDOW_DAYS}-day window so everyone gets a fair go.</span>
        </div>
      </div>
      <h1>Not yet bookable</h1>
      <p>${esc(meta.label)} on ${esc(fmtSessionDate(s.session_date))} opens for booking on <strong style="color:var(--gold)">${esc(fmtSessionDate(opensOn(s.session_date)))}</strong>.</p>
      <p style="margin-top:20px"><a href="/forms/training" style="color:var(--gold)">← Back to sessions</a></p>`));
  }
  if (s.booked >= s.capacity || !s.is_open) {
    return res.send(renderFormShell('Session full', `<h1>This session is full</h1>
      <p>${esc(meta.label)} on ${esc(fmtSessionDate(s.session_date))} is at capacity. <a href="/forms/training">View other sessions</a>.</p>`));
  }
  const slotSuffix = (s.discipline === 'air-pistol' && s.slot_index === 2) ? ' · Late slot' : (s.discipline === 'air-pistol' ? ' · Early slot' : '');
  res.send(renderFormShell(`Book ${meta.label}`, `
    <div class="members-banner">
      <span class="mb-icon">🔒</span>
      <div>
        <strong>MISC members only.</strong>
        <span>Wednesday training sessions are reserved for current MISC members.</span>
      </div>
    </div>
    <div class="training-intro">
      <span class="section-eyebrow gold-text">Booking · ${esc(meta.label)}${esc(slotSuffix)}</span>
      <h1>${esc(fmtSessionDate(s.session_date))}</h1>
      <p style="color:var(--muted)"><strong style="color:var(--text)">${esc(s.start_time)} – ${esc(s.end_time)}</strong> · ${s.capacity - s.booked} of ${s.capacity} spots left</p>
    </div>
    <form method="POST" action="/forms/training/book/${s.id}" class="form">
      <div class="row">
        <label>Your name *<input name="member_name" required maxlength="120"/></label>
        <label>Member number<input name="member_number" maxlength="40" placeholder="Optional"/></label>
      </div>
      <div class="row">
        <label>Email *<input name="member_email" type="email" required maxlength="200"/></label>
        <label>Phone<input name="member_phone" type="tel" maxlength="40"/></label>
      </div>
      <label>Experience level *
        <select name="experience" required>
          <option value="">-- choose --</option>
          <option value="beginner">Beginner — new to this discipline</option>
          <option value="intermediate">Intermediate — some experience</option>
          <option value="experienced">Experienced — regular shooter</option>
        </select>
      </label>
      <label class="checkbox-row">
        <input type="checkbox" name="has_own_kit" value="1"/>
        <span>I have my own pistol & ammunition (otherwise club kit will be provided)</span>
      </label>
      <label>Notes for the coach<textarea name="notes" rows="3" maxlength="1000" placeholder="Any injuries, accessibility needs, specific things to work on…"></textarea></label>
      <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
        <button type="submit" class="btn-sess">Confirm booking</button>
        <a href="/forms/training" style="color:var(--muted);text-decoration:underline">Cancel</a>
      </div>
    </form>`));
});

router.post('/forms/training/book/:sessionId', (req, res) => {
  const s = db.prepare(`
    SELECT s.*, (SELECT COUNT(*) FROM training_bookings b WHERE b.session_id = s.id AND b.status IN ('confirmed','attended')) AS booked
      FROM training_sessions s WHERE s.id = ?
  `).get(req.params.sessionId);
  if (!s) return res.status(404).send(renderFormShell('Not found', '<h1>Session not found</h1><p><a href="/forms/training">Back</a></p>'));
  if (!isInBookingWindow(s.session_date)) {
    return res.status(403).send(renderFormShell('Not yet bookable', `<h1>Bookings haven't opened for this session yet</h1>
      <p>Bookings for this session open on <strong>${esc(fmtSessionDate(opensOn(s.session_date)))}</strong>. <a href="/forms/training">Back to sessions</a></p>`));
  }
  if (s.booked >= s.capacity || !s.is_open) {
    return res.status(409).send(renderFormShell('Full', '<h1>Sorry — that session is now full</h1><p><a href="/forms/training">Pick another session</a></p>'));
  }
  const f = req.body || {};
  if (!f.member_name || !f.member_email || !f.experience) {
    return res.status(400).send(renderFormShell('Missing fields', `<h1>Missing required fields</h1><p>Please fill in your name, email and experience level. <a href="/forms/training/book/${s.id}">Try again</a></p>`));
  }
  // Per-member cap — don't let one member sweep every Wednesday slot
  const memberEmail = String(f.member_email).trim();
  const activeCount = countActiveBookings(memberEmail);
  if (activeCount >= MAX_ACTIVE_BOOKINGS) {
    return res.status(409).send(renderFormShell('Booking limit reached', `
      <h1>You're at the booking limit</h1>
      <p>You already have <strong>${activeCount}</strong> active training bookings. Members are limited to <strong>${MAX_ACTIVE_BOOKINGS}</strong> active bookings at a time so everyone gets a fair go on the line.</p>
      <p style="margin-top:18px;color:var(--muted)">Once you attend (or cancel) one of your current bookings, you can book another. To cancel a booking, email <a href="mailto:miscevents@misc.org.au" style="color:var(--gold)">miscevents@misc.org.au</a>.</p>
      <p style="margin-top:20px"><a href="/forms/training" style="color:var(--gold)">← Back to sessions</a></p>`));
  }
  // Prevent the same member double-booking the same session
  const dupe = db.prepare(`SELECT id FROM training_bookings WHERE session_id = ? AND LOWER(member_email) = LOWER(?) AND status = 'confirmed'`).get(s.id, memberEmail);
  if (dupe) {
    return res.status(409).send(renderFormShell('Already booked', `<h1>You're already booked into this session</h1>
      <p><a href="/forms/training" style="color:var(--gold)">View your other options</a></p>`));
  }
  db.prepare(`INSERT INTO training_bookings (session_id, member_name, member_email, member_phone, member_number, experience, has_own_kit, notes) VALUES (?,?,?,?,?,?,?,?)`)
    .run(s.id, String(f.member_name).trim(), memberEmail,
         f.member_phone || null, f.member_number || null, f.experience, f.has_own_kit ? 1 : 0, f.notes || null);
  const meta = DISCIPLINE_META[s.discipline] || { label: s.discipline };
  res.send(renderFormShell('Booking confirmed', `
    <div class="training-intro">
      <span class="section-eyebrow gold-text" style="color:#0fce6c">✓ Confirmed</span>
      <h1>You're booked in.</h1>
    </div>
    <div class="confirm-card">
      <table class="confirm-table">
        <tr><td>Discipline</td><td><strong>${esc(meta.label)}</strong></td></tr>
        <tr><td>Date</td><td><strong>${esc(fmtSessionDate(s.session_date))}</strong></td></tr>
        <tr><td>Time</td><td><strong>${esc(s.start_time)} – ${esc(s.end_time)}</strong></td></tr>
        <tr><td>Location</td><td>MISC · 120-128 Todd Road, Port Melbourne</td></tr>
      </table>
      <p style="color:var(--muted);margin-top:20px">A confirmation will be emailed to <strong style="color:var(--text)">${esc(f.member_email)}</strong>. Bring eye &amp; ear protection. If you need to cancel, please email <a href="mailto:miscevents@misc.org.au" style="color:var(--gold)">miscevents@misc.org.au</a>.</p>
      <p style="margin-top:18px"><a href="/forms/training" style="color:var(--gold)">← Book another session</a> &nbsp;·&nbsp; <a href="/" style="color:var(--gold)">Back to home</a></p>
    </div>
  `));
});

module.exports = router;
