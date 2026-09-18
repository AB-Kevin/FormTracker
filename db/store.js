"use strict";

// Plain JSON-file collections instead of a native SQLite binding. FormTracker
// is a single-user desktop tool operating on mailing lists of at most a few
// thousand contacts, well within the range where "load the whole collection,
// mutate, write it back" is simple and fast enough -- and it avoids pulling
// in a native module (better-sqlite3) that would need node-gyp/Visual Studio
// build tools to install, which the sibling Electron apps in this workspace
// (ApplicationManager, BillManager) deliberately avoid in favor of plain JSON
// sidecar files.

const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

let dataDir = null;

function init(userDataPath) {
  dataDir = path.join(userDataPath, "formtracker-data");
  fs.mkdirSync(dataDir, { recursive: true });
  for (const sub of ["pdf-templates", "generated-pdfs", "generated-letters", "attachments"]) {
    fs.mkdirSync(path.join(dataDir, sub), { recursive: true });
  }
}

function getDataDir() {
  return dataDir;
}

function collectionPath(name) {
  return path.join(dataDir, `${name}.json`);
}

function loadCollection(name, defaultValue) {
  try {
    return JSON.parse(fs.readFileSync(collectionPath(name), "utf8"));
  } catch {
    return defaultValue;
  }
}

function saveCollection(name, value) {
  fs.writeFileSync(collectionPath(name), JSON.stringify(value, null, 2), "utf8");
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

function update(name, id, patch) {
  const rows = list(name);
  const idx = rows.findIndex((row) => row.id === id);
  if (idx === -1) return null;
  rows[idx] = { ...rows[idx], ...patch, id };
  saveCollection(name, rows);
  return rows[idx];
}

function remove(name, id) {
  const rows = list(name);
  const next = rows.filter((row) => row.id !== id);
  saveCollection(name, next);
  return next.length !== rows.length;
}

function getSettings() {
  return loadCollection("settings", {});
}

function updateSettings(patch) {
  const current = getSettings();
  const next = { ...current, ...patch };
  saveCollection("settings", next);
  return next;
}

module.exports = {
  init,
  getDataDir,
  list,
  get,
  insert,
  insertMany,
  update,
  remove,
  getSettings,
  updateSettings,
};
