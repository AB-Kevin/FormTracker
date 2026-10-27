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
// people share, e.g. through OneDrive. Only the host computer writes the
// collection files; everyone else's changes go to it (see "sharing a data
// folder" below, and lib/team.js). settings.json never moves: it holds this
// computer's own SMTP login, theme, and secrets encrypted with this Windows
// account's key, so it stays in the local folder.

const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const DATA_SUBFOLDERS = ["pdf-templates", "generated-pdfs", "generated-letters", "attachments"];

let localDir = null;
let dataDir = null;
// Checked before every write of a collection file; throws to refuse it.
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

// A subfolder of the data folder, created on first use. Each file in one is
// named for what it holds (a UUID or a response token), so whichever computer
// writes it is its only writer.
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

// ---- sharing a data folder (see lib/team.js) ----
// Only the host computer writes the collection files. Anywhere else, a
// change is recorded as a list of exactly what changed -- rows added, fields
// set or cleared, rows removed -- in that computer's own changes file, for
// the host to apply. Until it has, this computer reads the shared files with
// its own changes laid on top, so its screens show them straight away.
// Applying a change twice leaves the same result, so laying one on top of a
// shared file that already has it does no harm. The same as SendNewsletters.
//
// `journal` is { role: "host" | "editor", append(change), pending() }; with
// none, this computer writes the files itself.
let journal = null;

function setJournal(next) {
  journal = next;
}

// The collections a change may touch: everything in a data folder.
const SHARED_COLLECTIONS = new Set(["contacts", "templates", "gravityForms", "mailings", "mailingRecipients", "responses", "gfForms", "gfUnmatched"]);

const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function getPath(object, dotted) {
  return dotted.split(".").reduce((o, key) => (o == null ? undefined : o[key]), object);
}

function setPath(object, dotted, value) {
  const keys = dotted.split(".");
  let o = object;
  for (const key of keys.slice(0, -1)) {
    if (!isPlainObject(o[key])) o[key] = {};
    o = o[key];
  }
  o[keys[keys.length - 1]] = clone(value);
}

function unsetPath(object, dotted) {
  const keys = dotted.split(".");
  let o = object;
  for (const key of keys.slice(0, -1)) {
    o = o?.[key];
    if (!isPlainObject(o)) return;
  }
  delete o[keys[keys.length - 1]];
}

// What changed between two versions of a row, down to the field --
// "extra.Committee", not the whole extra -- so two people changing different
// fields of one contact don't undo each other.
function diffFields(before, after, prefix = "", out = { set: {}, unset: [] }) {
  for (const key of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    const a = before?.[key];
    const b = after?.[key];
    if (b === undefined) {
      if (a !== undefined) out.unset.push(dotted);
    } else if (isPlainObject(a) && isPlainObject(b)) diffFields(a, b, dotted, out);
    else if (!sameJson(a, b)) out.set[dotted] = clone(b);
  }
  return out;
}

// Rows the caller didn't replace are the same objects in both, and skipped.
function diffRows(before, after) {
  const was = new Map(before.map((row) => [row.id, row]));
  const now = new Set(after.map((row) => row.id));
  const change = { inserts: [], patches: [], removes: [] };
  for (const row of after) {
    const old = was.get(row.id);
    if (!old) change.inserts.push(clone(row));
    else if (old !== row) {
      const fields = diffFields(old, row);
      if (Object.keys(fields.set).length || fields.unset.length) change.patches.push({ id: row.id, ...fields });
    }
  }
  for (const row of before) if (!now.has(row.id)) change.removes.push(row.id);
  return change;
}

const isEmptyChange = (c) => !c.inserts?.length && !c.patches?.length && !c.removes?.length;

// One recorded change applied to a collection's rows (returned as a new
// array; the rows passed in aren't touched). A row added that's already
// there is updated instead, and a change to a row someone has since removed
// is skipped.
function applyChange(rows, change) {
  const index = new Map(rows.map((row, i) => [row.id, i]));
  const next = rows.slice();
  const copied = new Set();
  const editable = (i) => {
    if (!copied.has(i)) {
      next[i] = clone(next[i]);
      copied.add(i);
    }
    return next[i];
  };
  for (const row of change.inserts || []) {
    if (index.has(row.id)) Object.assign(editable(index.get(row.id)), clone(row));
    else {
      index.set(row.id, next.length);
      copied.add(next.length);
      next.push(clone(row));
    }
  }
  for (const patch of change.patches || []) {
    const i = index.get(patch.id);
    if (i === undefined) continue;
    const row = editable(i);
    for (const [dotted, value] of Object.entries(patch.set || {})) setPath(row, dotted, value);
    for (const dotted of patch.unset || []) unsetPath(row, dotted);
  }
  if (!change.removes?.length) return next;
  const gone = new Set(change.removes);
  return next.filter((row) => !gone.has(row.id));
}

const pendingFor = (name) => (journal ? journal.pending().filter((c) => c.collection === name) : []);

// Writes a collection: the file itself on the host (or with no sharing), a
// recorded change anywhere else.
function commit(name, before, after) {
  if (journal?.role !== "editor") {
    saveCollection(name, after);
    return;
  }
  const change = { collection: name, ...diffRows(before, after) };
  if (!isEmptyChange(change)) journal.append(change);
}

// The host's job: applies changes other computers sent, in the order given
// (oldest first), each collection read and written once.
function applyIncoming(changes) {
  const byCollection = new Map();
  for (const change of changes) {
    if (!SHARED_COLLECTIONS.has(change.collection)) continue;
    if (!byCollection.has(change.collection)) byCollection.set(change.collection, []);
    byCollection.get(change.collection).push(change);
  }
  for (const [name, list] of byCollection) saveCollection(name, list.reduce(applyChange, loadCollection(name, [])));
}

// Whether the shared files already show a change -- once they do, the
// computer that made it can stop laying it on top.
function isReflected(change) {
  const fieldsMatch = (record, fields) =>
    Object.entries(fields.set || {}).every(([dotted, value]) => sameJson(getPath(record, dotted), value)) &&
    (fields.unset || []).every((dotted) => getPath(record, dotted) === undefined);
  const rows = new Map(loadCollection(change.collection, []).map((row) => [row.id, row]));
  return (
    (change.inserts || []).every((row) => rows.has(row.id)) &&
    (change.removes || []).every((id) => !rows.has(id)) &&
    (change.patches || []).every((patch) => !rows.has(patch.id) || fieldsMatch(rows.get(patch.id), patch))
  );
}

// ---- reading and changing collections ----
// Every change starts from list(), works on a copy of the array, and replaces
// (never edits) the rows it changes, so commit() can tell exactly what changed.

function list(name) {
  return pendingFor(name).reduce(applyChange, loadCollection(name, []));
}

function get(name, id) {
  return list(name).find((row) => row.id === id) || null;
}

function insert(name, row) {
  const before = list(name);
  const withId = { id: randomUUID(), createdAt: new Date().toISOString(), ...row };
  commit(name, before, [...before, withId]);
  return withId;
}

function insertMany(name, newRows) {
  if (!newRows.length) return [];
  const before = list(name);
  const withIds = newRows.map((row) => ({ id: randomUUID(), createdAt: new Date().toISOString(), ...row }));
  commit(name, before, [...before, ...withIds]);
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
  const before = list(name);
  const rows = before.slice();
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

  commit(name, before, rows);
  return { inserted, updated };
}

function update(name, id, patch) {
  const before = list(name);
  const idx = before.findIndex((row) => row.id === id);
  if (idx === -1) return null;
  const rows = before.slice();
  rows[idx] = { ...rows[idx], ...patch, id };
  commit(name, before, rows);
  return rows[idx];
}

// Applies patchFn(row) to every row in one load/save; rows for which it
// returns a falsy value are left untouched. Returns how many rows changed.
function updateWhere(name, patchFn) {
  const before = list(name);
  let changed = 0;
  const next = before.map((row) => {
    const patch = patchFn(row);
    if (!patch) return row;
    changed++;
    return { ...row, ...patch, id: row.id };
  });
  if (changed) commit(name, before, next);
  return changed;
}

function remove(name, id) {
  const before = list(name);
  const next = before.filter((row) => row.id !== id);
  if (next.length !== before.length) commit(name, before, next);
  return next.length !== before.length;
}

function removeWhere(name, predicate) {
  const before = list(name);
  const next = before.filter((row) => !predicate(row));
  if (next.length !== before.length) commit(name, before, next);
  return before.length - next.length;
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
  setJournal,
  applyIncoming,
  isReflected,
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
