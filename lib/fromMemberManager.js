"use strict";

// FormTracker's contacts from MemberManager's member list (ab-common's
// members.js; see main.js, "Contacts from MemberManager"). Every member --
// each member household's head, with a Member ID -- is a contact here, and
// MemberManager is the only place they're changed.
//
// FormTracker's mailings, tracking and responses point at its own contact
// ids, so contacts are never replaced: each is linked to its member
// (`memberManagerId`) and kept up to date from it. The first time, a contact
// is linked by its Member ID (externalId), or else by its name and email
// address. A contact whose member left MemberManager is removed here the
// usual way (removedAt), so the mailings it was in still show it; one that
// comes back is restored. Contacts someone removed here by hand stay
// removed.

const REMOVED_BY = "MemberManager";

/** A Member ID as compared: case, spaces and dashes don't matter. */
const memberKey = (id) => String(id || "").toUpperCase().replace(/[\s-]/g, "");
const personKey = (name, email) => {
  const n = String(name || "").toLowerCase().replace(/[^a-z]/g, "");
  const e = String(email || "").trim().toLowerCase();
  return n && e ? `${n}|${e}` : "";
};

/** A member as a FormTracker contact's fields: its own, and the rest as extra columns by name. */
function contactFields(member) {
  return {
    externalId: member.memberId,
    name: member.name,
    email: member.email,
    addressLine1: member.addressLine1,
    addressLine2: member.addressLine2,
    city: member.city,
    state: member.state,
    zip: member.zip,
    extra: { Organization: member.orgName, "Member status": member.memberStatus, ...member.fields },
    memberManagerId: member.id,
  };
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * What to change in `contacts` (FormTracker's, removed ones too) to match
 * `members` (ab-common's members(list)): { inserts, updates: [{ id, patch }],
 * linked, removed, restored }. `currentId(id)` is where a MemberManager person
 * is now -- themselves, the one they were merged into, or null.
 */
function planSync(contacts, members, currentId, { now = new Date().toISOString(), sourceBatch = "MemberManager" } = {}) {
  const byId = new Map(members.map((m) => [m.id, m]));
  const byMemberId = new Map();
  const byPerson = new Map();
  for (const m of members) {
    const key = memberKey(m.memberId);
    if (key && !byMemberId.has(key)) byMemberId.set(key, m);
    const person = personKey(m.name, m.email);
    if (person) byPerson.set(person, byPerson.has(person) ? null : m); // only when it's one person
  }

  // Each member goes to one contact: already linked ones first (the one
  // linked to that very person before one merged into them), then by Member
  // ID, then by name and email.
  const taken = new Map(); // member id -> contact
  const placed = new Set(); // contacts that have their member
  const claim = (contact, member) => {
    if (!member || taken.has(member.id) || placed.has(contact)) return false;
    taken.set(member.id, contact);
    placed.add(contact);
    return true;
  };
  const linked = contacts.filter((c) => c.memberManagerId);
  for (const c of linked) if (byId.has(c.memberManagerId)) claim(c, byId.get(c.memberManagerId));
  for (const c of linked) claim(c, byId.get(currentId(c.memberManagerId)));
  const unlinked = contacts.filter((c) => !c.memberManagerId);
  for (const c of unlinked) claim(c, byMemberId.get(memberKey(c.externalId)));
  for (const c of unlinked) claim(c, byPerson.get(personKey(c.name, c.email)) || null);

  const memberOf = new Map([...taken].map(([memberId, contact]) => [contact, byId.get(memberId)]));
  const out = { inserts: [], updates: [], linked: 0, removed: 0, restored: 0 };
  for (const c of contacts) {
    const member = memberOf.get(c);
    const patch = {};
    if (member) {
      for (const [key, value] of Object.entries(contactFields(member))) if (!same(c[key], value)) patch[key] = value;
      if (!c.memberManagerId) out.linked++;
      if (c.removedAt && c.removedBy === REMOVED_BY) {
        patch.removedAt = null;
        patch.removedBy = null;
        out.restored++;
      }
    } else if (!c.removedAt) {
      patch.removedAt = now;
      patch.removedBy = REMOVED_BY;
      out.removed++;
    }
    if (Object.keys(patch).length) out.updates.push({ id: c.id, patch });
  }
  for (const m of members) {
    if (!taken.has(m.id)) out.inserts.push({ id: m.id, ...contactFields(m), sourceBatch });
  }
  return out;
}

module.exports = { planSync, contactFields, REMOVED_BY };
