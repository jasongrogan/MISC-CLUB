/* ============================================================
   MISC CLUB — Sight Picture (ShootScore) API client
   ============================================================
   Node port of ~/SightPicture/sightpicture_api.py.
   Auth: AWS Cognito OAuth2 client-credentials (M2M) flow.
   Scope: shootscore-users/M2M.MISC.
   Credentials come from the `settings` table.
   ============================================================ */
const db = require('./db');

let _token = null;
let _tokenExpiry = 0;

function getCfg(key) {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key);
  if (!row || !row.value) throw new Error(`Sight Picture: missing setting ${key}`);
  return row.value;
}

/** Fetch and cache an OAuth bearer token. */
async function getToken() {
  if (_token && Date.now() < _tokenExpiry - 60_000) return _token;
  const clientId     = getCfg('SP_CLIENT_ID');
  const clientSecret = getCfg('SP_CLIENT_SECRET');
  const authUrl      = getCfg('SP_AUTH_URL');
  const creds        = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const resp = await fetch(authUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${creds}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`SP auth failed (${resp.status}): ${body}`);
  }
  const payload = await resp.json();
  _token = payload.access_token;
  _tokenExpiry = Date.now() + (payload.expires_in || 3600) * 1000;
  return _token;
}

/** Make an authenticated GET request to the Sight Picture API. */
async function spGet(pathStr, params = {}) {
  const token   = await getToken();
  const apiUrl  = getCfg('SP_API_URL').replace(/\/+$/, '');
  const clubId  = getCfg('SP_CLUB_ID');
  const qs      = new URLSearchParams({ clubId, ...params }).toString();
  const url     = `${apiUrl}${pathStr}?${qs}`;
  const resp    = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`SP GET ${pathStr} -> ${resp.status}: ${body.slice(0,200)}`);
  }
  return resp.json();
}

/** Return every member record for the configured club (currently MISC). */
async function listMembers() {
  return spGet('/members');
}

/** Score entries for a matchDetails prefix (typically a year like '2024'). */
async function matchScores(matchDetails) {
  return spGet('/match', { matchDetails: String(matchDetails) });
}

/** All score entries for one member across the given years. */
async function memberScores(memberId, years) {
  const yrs = (years && years.length) ? years : defaultYears();
  const id  = String(memberId);
  const out = [];
  for (const y of yrs) {
    const entries = await matchScores(String(y));
    for (const e of entries) if (e.memberId === id) out.push(e);
  }
  out.sort((a, b) => String(a.matchDetails || '').localeCompare(String(b.matchDetails || '')));
  return out;
}

/** Default score window: current calendar year + previous year. */
function defaultYears() {
  const y = new Date().getFullYear();
  return [String(y - 1), String(y)];
}

/** Quick liveness check. */
async function apiStatus() {
  const token = await getToken();
  const members = await listMembers();
  return { ok: true, tokenLength: token.length, memberCount: Array.isArray(members) ? members.length : 0 };
}

module.exports = {
  getToken,
  listMembers,
  matchScores,
  memberScores,
  apiStatus,
  defaultYears,
};
