/* ============================================================
   MISC CLUB — Member authentication helpers
   ============================================================
   Password hashing via Node's built-in scryptSync (no external deps).
   Sessions stored in the member_sessions table (DB-backed so a
   server restart doesn't kick everyone out).
   ============================================================ */
const crypto = require('crypto');
const db     = require('./db');

const MEMBER_COOKIE   = 'misc_member';
const SESSION_HOURS   = 12;
const SESSION_TTL_MS  = SESSION_HOURS * 60 * 60 * 1000;
const SCRYPT_KEYLEN   = 64;

/* ── password hashing ────────────────────────────────────── */
function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(password), s, SCRYPT_KEYLEN).toString('hex');
  return { salt: s, hash: h };
}
function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
  // timing-safe compare
  try {
    return crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(hash, 'hex'));
  } catch { return false; }
}

/** Default temp password for a fresh-synced member: `{memberNumber}temp1!` */
function defaultPasswordFor(memberNumber) {
  return `${String(memberNumber).trim()}temp1!`;
}

/* ── session management ──────────────────────────────────── */
function newToken() { return crypto.randomBytes(24).toString('hex'); }

function createSession(memberId) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare(`INSERT INTO member_sessions (token, member_id, expires_at) VALUES (?, ?, ?)`)
    .run(token, memberId, expiresAt);
  return token;
}

function destroySession(token) {
  if (!token) return;
  db.prepare(`DELETE FROM member_sessions WHERE token = ?`).run(token);
}

function setMemberCookie(res, token) {
  res.setHeader('Set-Cookie',
    `${MEMBER_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}`);
}
function clearMemberCookie(res) {
  res.setHeader('Set-Cookie', `${MEMBER_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function readCookieToken(req) {
  const cookies = (req.headers.cookie || '').split(';').map(s => s.trim());
  const c = cookies.find(s => s.startsWith(MEMBER_COOKIE + '='));
  if (!c) return null;
  return c.slice(MEMBER_COOKIE.length + 1);
}

/** Look up the member behind the current cookie; null if not authed/expired. */
function getCurrentMember(req) {
  const token = readCookieToken(req);
  if (!token) return null;
  const session = db.prepare(`SELECT * FROM member_sessions WHERE token = ?`).get(token);
  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) {
    db.prepare(`DELETE FROM member_sessions WHERE token = ?`).run(token);
    return null;
  }
  const member = db.prepare(`SELECT * FROM members WHERE id = ? AND is_active = 1`).get(session.member_id);
  if (!member) return null;
  member._session_token = token;
  return member;
}

/** Express middleware — require authenticated member; otherwise redirect or 401. */
function requireMember(req, res, next) {
  const m = getCurrentMember(req);
  if (!m) {
    if (req.path.startsWith('/api/') || req.headers.accept?.includes('application/json')) {
      return res.status(401).json({ error: 'unauthenticated' });
    }
    return res.redirect('/members/login?next=' + encodeURIComponent(req.originalUrl));
  }
  // First-login forced password change — only /change-password & /logout allowed
  if (m.must_change_password && !req.path.startsWith('/change-password') && !req.path.startsWith('/logout') && !req.path.startsWith('/api/me')) {
    return res.redirect('/members/change-password');
  }
  req.member = m;
  next();
}

/* ── housekeeping: clean expired sessions on startup ─────── */
db.prepare(`DELETE FROM member_sessions WHERE expires_at < datetime('now')`).run();

module.exports = {
  hashPassword,
  verifyPassword,
  defaultPasswordFor,
  createSession,
  destroySession,
  setMemberCookie,
  clearMemberCookie,
  getCurrentMember,
  requireMember,
  MEMBER_COOKIE,
};
