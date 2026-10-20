"use strict";

// Plain JSON-file collections instead of a native SQLite binding. FormTracker
// is a single-user desktop tool operating on mailing lists of at most a few
// thousand contacts, well within the range where "load the whole collection,
// mutate, write it back" is simple and fast enough -- and it avoids pulling
// in a native module (better-sqlite3) that would need node-gyp/Visual Studio
// build tools to install, which the sibling Electron apps in this workspace
// (ApplicationManager, BillManager) deliberately avoid in favor of plain JSON
// sidecar files.
//
// The data folder can be moved (Settings > Data location) to one several
// people share, e.g. through OneDrive -- see lib/dataLock.js for how only one
// of them edits at a time. settings.json never moves: it holds this
// computer's own SMTP login, theme, and secrets encrypted with this Windows
// account's key, so it stays in the local folder.

const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const DATA_SUBFOLDERS = ["pdf-templates", "generated-pdfs", "generated-letters", "attachments"];

let localDir = null;
let dataDir = null;
// Checked before every write to the data folder; throws to refuse it.
let writeGuard = () => {};

function init(userDataPath) {
  localDir = path.join(userDataPath, "formtracker-data");
  fs.mkdirSync(localDir, { recursive: true });
  setDataDir(getSettings().dataDir || localDir);
}

// The folder isn't created here: a shared folder that's missing (OneDrive
// not running yet, say) should show up as unavailable, not be silently
// replaced by an empty one.
function setDataDir(dir) {
  dataDir = dir;
}

function getDataDir() {
  return dataDir;
}

function getDefaultDataDir() {
  return localDir;
}

function setWriteGuard(guard) {
  writeGuard = guard;
}

// A subfolder of the data folder, created on first use.
function dataSubfolder(sub) {
  const dir = path.join(dataDir, sub);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Files kept in the data folder (PDF templates, letters, attachments) are
// recorded relative to it, so they still resolve when the folder is shared
// and sits at a different path on each computer.
function toStoredPath(absolutePath) {
  return path.relative(dataDir, absolutePath).split(path.sep).join("/");
}

// The reverse of toStoredPath. Paths recorded as absolute before that are
// looked for in this data folder by their subfolder and file name first, so
// copying the folder somewhere else keeps them working.
function resolvePath(stored) {
  if (!stored) return stored;
  if (!path.isAbsolute(stored)) return path.join(dataDir, stored);
  const parts = stored.split(/[\\/]/);
  const subIdx = parts.findLastIndex((part) => DATA_SUBFOLDERS.includes(part));
  if (subIdx !== -1) {
    const moved = path.join(dataDir, ...parts.slice(subIdx));
    if (fs.existsSync(moved)) return moved;
  }
  return stored;
}

function collectionPath(name) {
  return path.join(dataDir, `${name}.json`);
}

// A missing file is just an empty collection. Anything else unreadable
// (a half-synced or damaged file) is an error: treating it as empty would
// let the next save replace it with nothing.
function readJsonFile(filePath, defaultValue) {
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return defaultValue;
    throw new Error(`Couldn't read ${path.basename(filePath)}: ${err.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${path.basename(filePath)} is damaged and couldn't be read (${err.message}). Restore it from OneDrive's version history or a backup.`);
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Writes the whole file under a temporary name and then renames it into
// place, so OneDrive (or a crash) never sees a half-written file. Windows
// briefly refuses the rename while another process -- OneDrive, antivirus --
// has the target open, so that's retried.
function writeJsonFile(filePath, value) {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), "utf8");
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(tmpPath, filePath);
      return;
    } catch (err) {
      if (attempt >= 10 || !["EPERM", "EBUSY", "EACCES"].includes(err.code)) throw err;
      sleepSync(100 * attempt);
    }
  }
}

function loadCollection(name, defaultValue) {
  return readJsonFile(collectionPath(name), defaultValue);
}

function saveCollection(name, value) {
  writeGuard();
  writeJsonFile(collectionPath(name), value);
}

// Copies OneDrive made when two computers changed the same file before
// syncing -- it keeps one as e.g. "responses.json" and renames the other to
// "responses-DESKTOP-1234.json", which FormTracker never reads.
function findConflictCopies(dir) {
  let names;
  try {
    names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
  const present = new Set(names);
  return names.filter((name) => {
    const { name: base, ext } = path.parse(name);
    const dash = base.indexOf("-");
    return dash > 0 && present.has(base.slice(0, dash) + ext);
  });
}

function list(name) {
  return loadCollection(name, []);
}

function get(name, id) {
  return list(name).find((row) => row.id === id) || null;
}

function insert(name, row) {
  const rows = list(name);
  const withId = { id: randomUUID(), createdAt: new Date().toISOString(), ...row };
  rows.push(withId);
  saveCollection(name, rows);
  return withId;
}

function insertMany(name, newRows) {
  const rows = list(name);
  const withIds = newRows.map((row) => ({ id: randomUUID(), createdAt: new Date().toISOString(), ...row }));
  rows.push(...withIds);
  saveCollection(name, rows);
  return withIds;
}

// Inserts rows that don't match an existing row's `keyField` value; for ones
// that do, overwrites that existing row's fields in place (same internal id
// and createdAt) instead of adding a duplicate. Used for re-importing a
// contact list where the same external ID (e.g. GroupCode) should update the
// existing contact -- so its mailing/tracking history stays linked -- rather
// than creating a second contact. Rows with an empty/missing key always
// insert, since there's nothing to match them against.
function upsertMany(name, keyField, newRows) {
  const rows = list(name);
  const indexByKey = new Map();
  rows.forEach((row, idx) => {
    if (row[keyField]) indexByKey.set(row[keyField], idx);
  });

  let inserted = 0;
  let updated = 0;
  const now = new Date().toISOString();

  for (const row of newRows) {
    const key = row[keyField];
    const idx = key ? indexByKey.get(key) : undefined;
    if (idx !== undefined) {
      rows[idx] = { ...rows[idx], ...row, id: rows[idx].id, createdAt: rows[idx].createdAt };
      updated++;
    } else {
      const withId = { id: randomUUID(), createdAt: now, ...row };
      rows.push(withId);
      if (key) indexByKey.set(key, rows.length - 1);
      inserted++;
    }
  }

  saveCollection(name, rows);
  return { inserted, updated };
}

function update(name, id, patch) {
  const rows = list(name);
  const idx = rows.findIndex((row) => row.id === id);
  if (idx === -1) return null;
  rows[idx] = { ...rows[idx], ...patch, id };
  saveCollection(name, rows);
  return rows[idx];
}

// Applies patchFn(row) to every row in one load/save; rows for which it
// returns a falsy value are left untouched. Returns how many rows changed.
function updateWhere(name, patchFn) {
  const rows = list(name);
  let changed = 0;
  const next = rows.map((row) => {
    const patch = patchFn(row);
    if (!patch) return row;
    changed++;
    return { ...row, ...patch, id: row.id };
  });
  if (changed) saveCollection(name, next);
  return changed;
}

function remove(name, id) {
  const rows = list(name);
  const next = rows.filter((row) => row.id !== id);
  saveCollection(name, next);
  return next.length !== rows.length;
}

function removeWhere(name, predicate) {
  const rows = list(name);
  const next = rows.filter((row) => !predicate(row));
  saveCollection(name, next);
  return rows.length - next.length;
}

function settingsPath() {
  return path.join(localDir, "settings.json");
}

function getSettings() {
  return readJsonFile(settingsPath(), {});
}

function updateSettings(patch) {
  const current = getSettings();
  const next = { ...current, ...patch };
  writeJsonFile(settingsPath(), next);
  return next;
}

module.exports = {
  init,
  setDataDir,
  getDataDir,
  getDefaultDataDir,
  setWriteGuard,
  dataSubfolder,
  toStoredPath,
  resolvePath,
  writeJsonFile,
  findConflictCopies,
  list,
  get,
  insert,
  insertMany,
  upsertMany,
  update,
  updateWhere,
  remove,
  removeWhere,
  getSettings,
  updateSettings,
};
