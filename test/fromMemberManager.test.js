"use strict";

// FormTracker's contacts kept up to date from MemberManager (lib/fromMemberManager.js).

const test = require("node:test");
const assert = require("node:assert/strict");
const { planSync, REMOVED_BY } = require("../lib/fromMemberManager");

const member = (id, memberId, more = {}) => ({
  id,
  householdId: `h-${id}`,
  memberId,
  memberStatus: "Active",
  name: `Person ${id}`,
  email: `${id}@example.org`,
  addressLine1: "1 Main St",
  addressLine2: "",
  city: "Gordonville",
  state: "PA",
  zip: "17529",
  orgName: "Maple Grove",
  fields: {},
  ...more,
});
const noMerges = () => null;
const NOW = "2026-11-17T12:00:00.000Z";

test("the first time, contacts are linked to members by Member ID and keep their own ids", () => {
  const contacts = [{ id: "ft1", externalId: "beila-123", name: "Amos Beiler", email: "", extra: { statusTerm: "Active", fundName: "MAAP" } }];
  const plan = planSync(contacts, [member("mm1", "BEILA123", { name: "Amos Beiler", fields: { Plan: "MAAP" } })], noMerges, { now: NOW });
  assert.equal(plan.linked, 1);
  assert.deepEqual(plan.inserts, []);
  assert.equal(plan.updates[0].id, "ft1");
  assert.equal(plan.updates[0].patch.memberManagerId, "mm1");
  assert.equal(plan.updates[0].patch.externalId, "BEILA123");
  assert.deepEqual(plan.updates[0].patch.extra, { Organization: "Maple Grove", "Member status": "Active", Plan: "MAAP" }, "MemberManager's fields replace the old columns");
});

test("a contact without a Member ID is linked by name and email, if that's one person", () => {
  const contacts = [{ id: "ft1", externalId: "", name: "Ruth Zook", email: "RUTH@example.org" }];
  const plan = planSync(contacts, [member("mm1", "ZOOKR1", { name: "Ruth  Zook", email: "ruth@example.org" })], noMerges, { now: NOW });
  assert.equal(plan.linked, 1);
  assert.equal(plan.inserts.length, 0);
});

test("a new member becomes a new contact; a contact whose member left is removed, and restored if they come back", () => {
  const linked = (id, mmId, more = {}) => ({ id, memberManagerId: mmId, externalId: "", name: "", email: "", ...more });
  let plan = planSync([linked("ft1", "gone")], [member("mm2", "NEW2")], noMerges, { now: NOW });
  assert.deepEqual(plan.inserts.map((c) => [c.id, c.externalId, c.sourceBatch]), [["mm2", "NEW2", "MemberManager"]]);
  assert.deepEqual(plan.updates, [{ id: "ft1", patch: { removedAt: NOW, removedBy: REMOVED_BY } }]);

  plan = planSync([linked("ft1", "mm1", { removedAt: NOW, removedBy: REMOVED_BY })], [member("mm1", "BACK1")], noMerges, { now: NOW });
  assert.equal(plan.restored, 1);
  assert.equal(plan.updates[0].patch.removedAt, null);
});

test("someone removed by hand here stays removed, and still gets MemberManager's changes", () => {
  const contacts = [{ id: "ft1", memberManagerId: "mm1", externalId: "A1", name: "Old name", email: "", removedAt: NOW }];
  const plan = planSync(contacts, [member("mm1", "A1", { name: "New name" })], noMerges, { now: NOW });
  assert.equal(plan.updates[0].patch.name, "New name");
  assert.equal("removedAt" in plan.updates[0].patch, false);
});

test("when MemberManager merges two members, the contact for the one kept stays and the other is removed", () => {
  const contacts = [
    { id: "ftA", memberManagerId: "mmA", externalId: "A", name: "", email: "" },
    { id: "ftB", memberManagerId: "mmB", externalId: "B", name: "", email: "" },
  ];
  const currentId = (id) => (id === "mmB" ? "mmA" : id);
  const plan = planSync(contacts, [member("mmA", "A")], currentId, { now: NOW });
  assert.deepEqual(plan.inserts, []);
  assert.equal(plan.updates.find((u) => u.id === "ftB").patch.removedBy, REMOVED_BY);
  assert.equal(plan.updates.find((u) => u.id === "ftA").patch.removedAt, undefined);
});

test("a contact merged into a member nobody here has yet carries on as that member", () => {
  const contacts = [{ id: "ftB", memberManagerId: "mmB", externalId: "B", name: "", email: "" }];
  const plan = planSync(contacts, [member("mmA", "A")], (id) => (id === "mmB" ? "mmA" : id), { now: NOW });
  assert.deepEqual(plan.inserts, []);
  assert.equal(plan.updates[0].patch.memberManagerId, "mmA");
});

test("nothing changes once everything matches", () => {
  const m = member("mm1", "A1");
  const first = planSync([], [m], noMerges, { now: NOW }).inserts[0];
  const plan = planSync([first], [m], noMerges, { now: NOW });
  assert.deepEqual(plan.updates, []);
  assert.deepEqual(plan.inserts, []);
});
