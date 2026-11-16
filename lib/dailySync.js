"use strict";

// The daily Gravity Forms sync. The host computer -- the only one that
// records responses (see main.js, "Sharing a data folder") -- checks the
// website once a day while FormTracker is open there, and matches every new
// submission. Every other computer shows a notice when no check has
// succeeded in two days; the host shows one when its own last check failed.
// The same arrangement as ApplicationManager's daily import.
//
// What it knows lives in the shared data folder's gfSync.json, as one row
// (key "status") written only by the host, so every computer reads the same:
//   lastCheckAt  -- the last successful check, daily or "Sync now"
//   lastCheckBy  -- the name of whoever's computer made it
//   lastCheckOn  -- that computer's Windows name
//   lastMatched  -- how many responses it matched
//   lastError    -- { at, message } from the last failed check, or null
//
// A check fails if any connection couldn't be checked; the others are still
// matched, but the check is tried again an hour later rather than the next day.

const DAILY_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
// Other computers warn once nothing has been checked for this long.
const DAILY_SYNC_LATE_MS = 48 * 60 * 60 * 1000;
// A failed check is tried again after this long, not on every tick.
const DAILY_SYNC_RETRY_MS = 60 * 60 * 1000;

const timeOf = (iso) => {
  const t = Date.parse(iso || "");
  return Number.isNaN(t) ? null : t;
};

// When there was first something for the sync to check: the oldest mailing
// tied to a connection it can match responses for, as an ISO string. null
// when there's nothing to check, so a team that doesn't use Gravity Forms is
// never warned. Mirrors which mailings syncGravityForms (main.js) looks at.
function watchingSince(gravityForms, mailings, recipients) {
  const usable = new Set(gravityForms.filter((gf) => gf.formId && (gf.tokenFieldId || gf.memberIdFieldId)).map((gf) => gf.id));
  const withRecipients = new Set(recipients.map((r) => r.mailingId));
  const times = mailings
    .filter((m) => usable.has(m.gravityFormId) && withRecipients.has(m.id))
    .map((m) => timeOf(m.createdAt))
    .filter((t) => t !== null);
  return times.length ? new Date(Math.min(...times)).toISOString() : null;
}

// Whether the host should check now.
function dailySyncDue(status, now) {
  const lastError = timeOf(status?.lastError?.at);
  if (lastError !== null && now - lastError < DAILY_SYNC_RETRY_MS) return false;
  const last = timeOf(status?.lastCheckAt);
  return last === null || now - last >= DAILY_SYNC_INTERVAL_MS;
}

// What a computer should warn about, or null:
//   { kind: "failing", message, at }          this computer is the host, and its last check failed
//   { kind: "late", lastCheckAt, lastCheckBy, message }
//                                             it isn't, and nothing has been checked for two days
// `since` is watchingSince's answer: with nothing to check there's nothing to
// warn about, and a first mailing gets its two days too.
function dailySyncWarning(status, { isHost, since, now }) {
  if (!since) return null;
  if (isHost) {
    return status?.lastError ? { kind: "failing", message: status.lastError.message, at: status.lastError.at } : null;
  }
  const times = [status?.lastCheckAt, since].map(timeOf).filter((t) => t !== null);
  if (times.length && now - Math.max(...times) <= DAILY_SYNC_LATE_MS) return null;
  return {
    kind: "late",
    lastCheckAt: status?.lastCheckAt || null,
    lastCheckBy: status?.lastCheckBy || null,
    message: status?.lastError?.message || null,
  };
}

module.exports = {
  DAILY_SYNC_INTERVAL_MS,
  DAILY_SYNC_LATE_MS,
  DAILY_SYNC_RETRY_MS,
  watchingSince,
  dailySyncDue,
  dailySyncWarning,
};
