"use strict";

// Keeps FormTracker from versions before the host and editors (see
// lib/team.js) out of the way while computers are updated one at a time.
// Those versions edited only while holding formtracker.lock in the data
// folder, wrote the files directly, and showed everyone else a read-only
// view. So:
//
// - the acting host keeps a lock of its own there, with a heartbeat, so an
//   older version on another computer opens read-only rather than writing
//   over the host's saves;
// - while an older version holds an active lock (it was editing first, or
//   someone chose its "Take over editing"), this computer doesn't act as
//   host: changes made here wait, and are saved once that copy closes.
//
// The lock reaches other computers only as fast as OneDrive syncs it, the
// same as before. Once every computer is updated this does nothing.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { randomUUID } = require("crypto");
const store = require("../db/store");

const LOCK_FILE = "formtracker.lock";
const HEARTBEAT_MS = 60 * 1000;
// How long an older version's lock counts without a heartbeat, as those
// versions judged it.
const STALE_MS = 15 * 60 * 1000;

const me = { sessionId: randomUUID(), user: os.userInfo().username, machine: os.hostname(), pid: process.pid, team: true };

let dir = null;
let holding = false;
let acquiredAt = null;
let timer = null;

const lockPath = () => path.join(dir, LOCK_FILE);

function readLock() {
  try {
    return JSON.parse(fs.readFileSync(lockPath(), "utf8"));
  } catch {
    return null; // none, or mid-sync: the next check sees it
  }
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

function writeOurs() {
  store.writeJsonFile(lockPath(), { ...me, acquiredAt, heartbeatAt: new Date().toISOString() });
}

function start(dataDir) {
  stop();
  dir = dataDir;
}

/** Gives up this computer's lock, if it holds one. */
function stop() {
  clearInterval(timer);
  timer = null;
  if (dir && holding && readLock()?.sessionId === me.sessionId) {
    try {
      fs.rmSync(lockPath(), { force: true });
    } catch {
      // Left behind; older versions treat it as stale after STALE_MS.
    }
  }
  holding = false;
}

/** The name an older version shows for who's editing: the AB Apps name, or the Windows user name. */
function setUser(name) {
  me.user = name || os.userInfo().username;
  if (holding) heartbeat();
}

/** Whether this computer, as acting host, keeps the lock. */
function hold(acting) {
  if (acting === holding) return;
  if (!acting) return stop();
  holding = true;
  acquiredAt = new Date().toISOString();
  heartbeat();
  timer = setInterval(heartbeat, HEARTBEAT_MS);
}

function heartbeat() {
  try {
    writeOurs();
  } catch {
    // The folder is unavailable for now; the next heartbeat tries again.
  }
}

/**
 * An older FormTracker editing this folder right now: { user, machine }, or
 * null. A lock from this version (any computer's) doesn't count.
 */
function olderEditor() {
  if (!dir) return null;
  const lock = readLock();
  if (!lock || lock.team || lock.sessionId === me.sessionId) return null;
  const active = lock.machine === me.machine ? processAlive(lock.pid) : Date.now() - new Date(lock.heartbeatAt).getTime() < STALE_MS;
  return active ? { user: lock.user, machine: lock.machine } : null;
}

module.exports = { start, stop, setUser, hold, olderEditor };
