// ============================================================
//  lib/util.js — shared helpers (timezone, serialisation)
// ============================================================
const TZ = 'Asia/Manila';
const MANILA_OFFSET_MIN = 8 * 60; // Philippines has no DST

const pad = (n) => String(n).padStart(2, '0');

/** Date → "YYYY-MM-DD HH:MM:SS" in Manila time (same shape the old Postgres API returned). */
function fmtTs(d) {
  if (!d) return null;
  const m = new Date(new Date(d).getTime() + MANILA_OFFSET_MIN * 60000);
  return `${m.getUTCFullYear()}-${pad(m.getUTCMonth() + 1)}-${pad(m.getUTCDate())} ` +
         `${pad(m.getUTCHours())}:${pad(m.getUTCMinutes())}:${pad(m.getUTCSeconds())}`;
}

/** Today's date (YYYY-MM-DD) in Manila. */
function todayManila() { return fmtTs(new Date()).slice(0, 10); }

/** "YYYY-MM-DD" (a Manila calendar day) → UTC Date at 00:00 Manila time. */
function dayStart(ymd) { return new Date(`${ymd}T00:00:00+08:00`); }

/** Add n days to a YYYY-MM-DD string. */
function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

const isYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Mongo aggregation expression: Manila calendar day string of created_at. */
const DAY_EXPR = { $dateToString: { format: '%Y-%m-%d', date: '$created_at', timezone: TZ } };

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Strip Mongo's _id and format timestamps for API output. */
function clean(doc) {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  if (rest.created_at instanceof Date) rest.created_at = fmtTs(rest.created_at);
  return rest;
}

const BRANCH_KEYS = {
  festive: 1, sm_central: 2, gen_luna: 3, jaro: 4,
  molo: 5, la_paz: 6, calumpang: 7, tagbak: 8,
};

module.exports = {
  TZ, fmtTs, todayManila, dayStart, addDays, isYmd, DAY_EXPR, round2, clean, BRANCH_KEYS,
};
