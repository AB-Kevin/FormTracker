"use strict";

// Two computers sharing one data folder (lib/team.js, db/store.js): a host,
// which writes the shared files, and an editor, whose changes go to it. Each
// computer gets its own copy of the store module, as each app has one.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { randomUUID } = require("crypto");
const { Team } = require("../lib/team");

const STORE = require.resolve("../db/store");

function freshStore(userData, dataDir) {
  delete require.cache[STORE];
  const store = require(STORE);
  store.init(userData);
  store.setDataDir(dataDir);
  return store;
}

/** A computer: its store, its place in the team, and its part (host or editor). */
function computer(root, dataDir, name, { host }) {
  const userData = fs.mkdtempSync(path.join(root, `${name}-`));
  const store = freshStore(userData, dataDir);
  const team = new Team({ id: randomUUID(), name, abAppsId: null });
  team.open(dataDir, { isHost: host, hostSince: host ? new Date().toISOString() : null });
  team.setActing(host);
  store.setJournal(team.journal);
  return {
    store,
    team,
    // The host's job (main.js, saveIncoming): save everyone's changes.
    saveIncoming() {
      const changes = team.incoming();
      store.applyIncoming(changes);
      team.markApplied(changes);
      return changes.length;
    },
  };
}

function setUp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "formtracker-sharing-"));
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir);
  const host = computer(root, dataDir, "Host", { host: true });
  const editor = computer(root, dataDir, "Editor", { host: false });
  t.after(() => {
    host.team.close();
    editor.team.close();
  });
  const file = (name) => JSON.parse(fs.readFileSync(path.join(dataDir, `${name}.json`), "utf8"));
  return { dataDir, host, editor, file };
}

test("the host writes the shared files; an editor's changes wait for it, and show on the editor straight away", (t) => {
  const { host, editor, file } = setUp(t);
  const c = host.store.insert("contacts", { name: "Amos Beiler", email: "", extra: { Committee: "" } });
  assert.equal(file("contacts").length, 1);

  editor.store.update("contacts", c.id, { email: "amos@example.org" });
  assert.equal(file("contacts")[0].email, "", "not in the shared file yet");
  assert.equal(editor.store.get("contacts", c.id).email, "amos@example.org", "but shown on the editor");
  assert.equal(editor.team.unsavedCount(), 1);

  assert.equal(host.saveIncoming(), 1);
  assert.equal(file("contacts")[0].email, "amos@example.org");
  assert.equal(host.store.get("contacts", c.id).email, "amos@example.org");
  assert.equal(editor.team.unsavedCount(), 0);
  editor.team.trim(editor.store.isReflected);
  assert.equal(editor.team.changes.length, 0, "dropped once the shared file shows it");
  assert.equal(editor.store.get("contacts", c.id).email, "amos@example.org");
});

test("two computers changing different fields of one record both keep their change", (t) => {
  const { host, editor, file } = setUp(t);
  const c = host.store.insert("contacts", { name: "Mary Esh", email: "", extra: { Committee: "", Over65: "" } });
  editor.store.update("contacts", c.id, { extra: { ...c.extra, Committee: "Finance" } });
  host.store.update("contacts", c.id, { name: "Mary A Esh", extra: { ...c.extra, Over65: "Yes" } });
  host.saveIncoming();
  const saved = file("contacts")[0];
  assert.equal(saved.name, "Mary A Esh");
  assert.deepEqual(saved.extra, { Committee: "Finance", Over65: "Yes" });
});

test("an editor's import, removals and new records all reach the shared files", (t) => {
  const { host, editor, file } = setUp(t);
  const kept = host.store.insert("templates", { name: "Kept" });
  const gone = host.store.insert("templates", { name: "Gone" });
  const rows = Array.from({ length: 500 }, (_, i) => ({ externalId: `M${i}`, name: `Member ${i}`, extra: {} }));
  assert.deepEqual(editor.store.upsertMany("contacts", "externalId", rows), { inserted: 500, updated: 0 });
  assert.deepEqual(editor.store.upsertMany("contacts", "externalId", [{ externalId: "M7", name: "Member Seven" }]), { inserted: 0, updated: 1 });
  editor.store.remove("templates", gone.id);
  const mailing = editor.store.insert("mailings", { name: "Fall survey", status: "draft" });
  assert.equal(editor.store.list("contacts").length, 500);

  host.saveIncoming();
  assert.equal(file("contacts").length, 500);
  assert.equal(file("contacts").find((c) => c.externalId === "M7").name, "Member Seven");
  assert.deepEqual(file("templates").map((x) => x.id), [kept.id]);
  assert.equal(file("mailings")[0].id, mailing.id);
});

test("an editor never writes the shared files, even with the folder to itself", (t) => {
  const { editor, dataDir } = setUp(t);
  editor.store.insert("responses", { recipientId: "r1" });
  assert.equal(fs.existsSync(path.join(dataDir, "responses.json")), false);
  assert.equal(editor.store.list("responses").length, 1);
});

test("changes wait safely while the host is closed, and are saved when it's back", (t) => {
  const { host, editor, dataDir, file } = setUp(t);
  host.team.close();
  const c = editor.store.insert("contacts", { name: "Daniel Fisher", extra: {} });
  // The editor's app closes and opens again before the host's does.
  editor.team.close();
  editor.team.open(dataDir, { isHost: false, hostSince: null });
  assert.equal(editor.store.get("contacts", c.id).name, "Daniel Fisher", "still shown after a restart");
  host.team.open(dataDir, { isHost: true, hostSince: new Date().toISOString() });
  host.saveIncoming();
  assert.equal(file("contacts")[0].name, "Daniel Fisher");
});

test("an older FormTracker editing the folder is noticed, and this version's lock isn't", (t) => {
  const { dataDir } = setUp(t);
  delete require.cache[require.resolve("../lib/legacyLock")];
  const legacyLock = require("../lib/legacyLock");
  legacyLock.start(dataDir);
  const lockFile = path.join(dataDir, "formtracker.lock");
  const older = { sessionId: randomUUID(), user: "ruth", machine: "OFFICE-2", pid: 1, acquiredAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() };
  fs.writeFileSync(lockFile, JSON.stringify(older));
  assert.deepEqual(legacyLock.olderEditor(), { user: "ruth", machine: "OFFICE-2" });
  fs.writeFileSync(lockFile, JSON.stringify({ ...older, heartbeatAt: new Date(Date.now() - 20 * 60 * 1000).toISOString() }));
  assert.equal(legacyLock.olderEditor(), null, "gone quiet: stale");

  legacyLock.hold(true);
  const ours = JSON.parse(fs.readFileSync(lockFile, "utf8"));
  assert.equal(ours.team, true, "marked as this version's");
  assert.equal(legacyLock.olderEditor(), null);
  legacyLock.stop();
  assert.equal(fs.existsSync(lockFile), false, "given up on closing");
});
