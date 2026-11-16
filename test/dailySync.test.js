"use strict";

// The daily Gravity Forms sync (lib/dailySync.js): when the host checks, and
// when the other computers warn.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DAILY_SYNC_INTERVAL_MS,
  DAILY_SYNC_LATE_MS,
  DAILY_SYNC_RETRY_MS,
  watchingSince,
  dailySyncDue,
  dailySyncWarning,
} = require("../lib/dailySync");

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-11-16T15:00:00Z");
const ago = (ms) => new Date(NOW - ms).toISOString();

test("it watches from the oldest mailing tied to a connection it can match", () => {
  const gravityForms = [
    { id: "gf1", formId: "3", tokenFieldId: "5" },
    { id: "gf2", formId: "4", memberIdFieldId: "2" },
    { id: "gf3", formId: "", tokenFieldId: "5" }, // no form chosen
    { id: "gf4", formId: "6" }, // nothing to match by
  ];
  const mailings = [
    { id: "m1", gravityFormId: "gf1", createdAt: "2026-10-01T00:00:00Z" },
    { id: "m2", gravityFormId: "gf2", createdAt: "2026-09-01T00:00:00Z" },
    { id: "m3", gravityFormId: "gf3", createdAt: "2026-01-01T00:00:00Z" },
    { id: "m4", gravityFormId: "gf4", createdAt: "2026-02-01T00:00:00Z" },
    { id: "m5", gravityFormId: null, createdAt: "2026-03-01T00:00:00Z" },
    { id: "m6", gravityFormId: "gf1", createdAt: "2026-04-01T00:00:00Z" }, // no recipients
  ];
  const recipients = ["m1", "m2", "m3", "m4", "m5"].map((mailingId) => ({ mailingId }));
  assert.equal(watchingSince(gravityForms, mailings, recipients), "2026-09-01T00:00:00.000Z");
  assert.equal(watchingSince(gravityForms, mailings.slice(2), recipients), null);
  assert.equal(watchingSince([], [], []), null);
});

test("the host checks once a day", () => {
  assert.equal(dailySyncDue({ lastCheckAt: ago(DAILY_SYNC_INTERVAL_MS - HOUR) }, NOW), false);
  assert.equal(dailySyncDue({ lastCheckAt: ago(DAILY_SYNC_INTERVAL_MS) }, NOW), true);
  assert.equal(dailySyncDue(null, NOW), true); // never checked
  assert.equal(dailySyncDue({}, NOW), true);
});

test("a failed check is tried again an hour later, not on every tick", () => {
  const status = { lastCheckAt: ago(3 * 24 * HOUR), lastError: { at: ago(HOUR / 2), message: "500" } };
  assert.equal(dailySyncDue(status, NOW), false);
  assert.equal(dailySyncDue({ ...status, lastError: { at: ago(DAILY_SYNC_RETRY_MS), message: "500" } }, NOW), true);
});

test("nobody is warned when there's nothing to check", () => {
  assert.equal(dailySyncWarning(null, { isHost: false, since: null, now: NOW }), null);
  assert.equal(dailySyncWarning({ lastError: { at: ago(HOUR), message: "401" } }, { isHost: true, since: null, now: NOW }), null);
});

test("other computers warn after two days without a check", () => {
  const since = ago(30 * 24 * HOUR);
  const status = { lastCheckAt: ago(DAILY_SYNC_LATE_MS - HOUR), lastCheckBy: "Mary Martin" };
  assert.equal(dailySyncWarning(status, { isHost: false, since, now: NOW }), null);
  const late = { ...status, lastCheckAt: ago(DAILY_SYNC_LATE_MS + HOUR), lastError: { at: ago(HOUR), message: "403" } };
  assert.deepEqual(dailySyncWarning(late, { isHost: false, since, now: NOW }), {
    kind: "late",
    lastCheckAt: late.lastCheckAt,
    lastCheckBy: "Mary Martin",
    message: "403",
  });
});

test("a first mailing gets its two days, and then it's late if never checked", () => {
  assert.equal(dailySyncWarning(null, { isHost: false, since: ago(HOUR), now: NOW }), null);
  assert.deepEqual(dailySyncWarning(null, { isHost: false, since: ago(DAILY_SYNC_LATE_MS + HOUR), now: NOW }), {
    kind: "late",
    lastCheckAt: null,
    lastCheckBy: null,
    message: null,
  });
});

test("the host warns only about its own failures", () => {
  const since = ago(30 * 24 * HOUR);
  const status = { lastCheckAt: ago(5 * 24 * HOUR) };
  assert.equal(dailySyncWarning(status, { isHost: true, since, now: NOW }), null);
  const failing = { ...status, lastError: { at: ago(HOUR), message: "Gravity Forms API error 401" } };
  assert.deepEqual(dailySyncWarning(failing, { isHost: true, since, now: NOW }), {
    kind: "failing",
    message: "Gravity Forms API error 401",
    at: failing.lastError.at,
  });
});
