"use strict";

// Lets several people share one data folder (synced through OneDrive, say)
// without overwriting each other's work. The store rewrites a whole
// collection file on every change, and when two computers change the same
// file OneDrive keeps only one of them -- so only one computer edits at a
// time. It records itself in a lock file in the data folder; everyone else
// gets a read-only view until it closes FormTracker or someone takes over.
//
// The lock reaches other computers only as fast as OneDrive syncs it, so two
// people opening FormTracker within the same minute or so could both take
// it. The editor re-reads the lock shortly after taking it, every minute
// after that, and before every change (assertEditing), and drops to
// read-only as soon as it finds someone else's.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { randomUUID } = require("crypto");
const store = require("../db/store");

const LOCK_FILE = "formtracker.lock";
const HEARTBEAT_MS = 60 * 1000;
const CONFIRM_DELAY_MS = 15 * 1000;
// How long without a heartbeat before a lock counts as left behind (a crash,
// or a laptop closed without quitting). Generous, since the heartbeat itself
// only arrives as fast as OneDrive syncs it.
const STALE_MS = 15 * 60 * 1000;
const CHANGE_DEBOUNCE_MS = 1500;

const me = { sessionId: randomUUID(), user: os.userInfo().username, machine: os.hostname(), pid: process.pid };

let dir = null;
let mode = "unavailable"; // "editing" | "read-only" | "unavailable"
let holder = null; // the lock file's contents when it isn't ours
let acquiredAt = null;
let conflicts = [];
let heartbeatTimer = null;
let confirmTimer = null;
let watcher = null;
let changeTimer = null;
let lastNotified = "";
let stateListener = () => {};
let changeListener = () => {};

function lockPath() {
  return path.join(dir, LOCK_FILE);
}

// null if there's no lock, or it can't be read -- with atomic writes that
// only happens mid-sync, and the next check sees it.
function readLock() {
  try {
    return JSON.parse(fs.readFileSync(lockPath(), "utf8"));
  } catch {
    return null;
  }
}

function isOurs(lock) {
  return lock?.sessionId === me.sessionId;
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

// Whether someone else's lock still belongs to a running FormTracker. On
// this computer that can be checked directly; elsewhere, by its heartbeat.
function isActive(lock) {
  if (!lock || isOurs(lock)) return false;
  if (lock.machine === me.machine) return processAlive(lock.pid);
  return Date.now() - new Date(lock.heartbeatAt).getTime() < STALE_MS;
}

function writeOurs() {
  store.writeJsonFile(lockPath(), { ...me, acquiredAt, heartbeatAt: new Date().toISOString() });
}

function getState() {
  return {
    mode,
    dataDir: dir,
    me: { user: me.user, machine: me.machine },
    holder: holder && {
      user: holder.user,
      machine: holder.machine,
      acquiredAt: holder.acquiredAt,
      heartbeatAt: holder.heartbeatAt,
      active: isActive(holder),
    },
    conflicts,
  };
}

function setState(nextMode, nextHolder) {
  mode = nextMode;
  holder = nextHolder;
  const state = getState();
  const key = JSON.stringify([state.mode, holder?.sessionId, state.holder?.active, conflicts]);
  if (key === lastNotified) return;
  lastNotified = key;
  stateListener(state);
}

// Only the read-only view cares: the editor is the only one changing files.
function watchForChanges() {
  if (watcher) return;
  try {
    watcher = fs.watch(dir, (eventType, fileName) => {
      if (mode === "editing" || !/\.json$/i.test(fileName || "")) return;
      clearTimeout(changeTimer);
      changeTimer = setTimeout(() => changeListener(), CHANGE_DEBOUNCE_MS);
    });
    watcher.on("error", () => {
      watcher?.close();
      watcher = null;
    });
  } catch {
    watcher = null;
  }
}

// Takes the lock unless someone else is actively holding it (or regardless,
// with `force`). Returns whether this computer is now the editor.
function acquire(force = false) {
  if (!fs.existsSync(dir)) {
    setState("unavailable", null);
    return false;
  }
  const lock = readLock();
  if (!force && isActive(lock)) {
    setState("read-only", lock);
    return false;
  }
  acquiredAt = new Date().toISOString();
  writeOurs();
  setState("editing", null);
  clearTimeout(confirmTimer);
  confirmTimer = setTimeout(check, CONFIRM_DELAY_MS);
  return true;
}

function check() {
  try {
    if (!fs.existsSync(dir)) return setState("unavailable", null);
    watchForChanges();
    conflicts = store.findConflictCopies(dir);
    // Back from unavailable (OneDrive started late, say): start over as if
    // FormTracker had just opened.
    if (mode === "unavailable") return acquire();
    const lock = readLock();
    if (mode === "editing") {
      if (lock && !isOurs(lock)) return setState("read-only", lock);
      writeOurs();
      return setState("editing", null);
    }
    setState("read-only", lock);
  } catch (err) {
    console.error("Data folder lock check failed:", err);
  }
}

// Called before every change to the data folder. Re-reads the lock rather
// than trusting the last check, since someone may have taken over since.
function assertEditing() {
  if (mode === "editing") {
    const lock = readLock();
    if (!lock || isOurs(lock)) return;
    setState("read-only", lock);
  }
  throw new Error(readOnlyReason());
}

function readOnlyReason() {
  if (mode === "unavailable") {
    return `The data folder (${dir}) can't be reached, so nothing can be saved. Check that OneDrive is running and the folder is synced.`;
  }
  if (holder && isActive(holder)) {
    return `${holder.user} on ${holder.machine} is editing, so FormTracker is read-only here. Nothing was saved.`;
  }
  return "FormTracker is read-only here. Use Start editing at the top of the window to make changes. Nothing was saved.";
}

function start(dataDir) {
  stop();
  dir = dataDir;
  mode = "unavailable";
  lastNotified = "";
  check();
  heartbeatTimer = setInterval(check, HEARTBEAT_MS);
}

// Gives the lock up (if this computer has it) and stops checking.
function stop() {
  clearInterval(heartbeatTimer);
  clearTimeout(confirmTimer);
  clearTimeout(changeTimer);
  watcher?.close();
  watcher = null;
  if (dir && mode === "editing" && isOurs(readLock())) {
    try {
      fs.unlinkSync(lockPath());
    } catch (err) {
      console.error("Couldn't release the data folder lock:", err);
    }
  }
  mode = "unavailable";
  holder = null;
}

module.exports = {
  start,
  stop,
  acquire,
  check,
  assertEditing,
  isEditing: () => mode === "editing",
  getState,
  onStateChange: (listener) => (stateListener = listener),
  onExternalChange: (listener) => (changeListener = listener),
};
