"use strict";

const { CORE_FIELDS } = require("./csvImport");

function getFieldValue(contact, field) {
  if (field.startsWith("extra.")) return contact.extra?.[field.slice("extra.".length)];
  if (CORE_FIELDS.includes(field)) return contact[field];
  return contact.extra?.[field];
}

function matchesRule(contact, rule) {
  return matchesValue(getFieldValue(contact, rule.field), rule);
}

function matchesValue(rawValue, rule) {
  const value = String(rawValue ?? "").toLowerCase();
  const target = String(rule.value ?? "").toLowerCase();
  switch (rule.op) {
    case "equals":
      return value === target;
    case "notEquals":
      return value !== target;
    case "contains":
      return value.includes(target);
    case "notEmpty":
      return value.trim() !== "";
    case "empty":
      return value.trim() === "";
    case "in":
      return target
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .includes(value);
    default:
      return true;
  }
}

// A mailing's parameter selection (requirement 2): every rule must match
// (AND) -- simple and predictable, and sufficient for "pick a subset of the
// list by field values" without a query-builder UI more complex than the
// task needs.
function filterContacts(contacts, rules) {
  if (!rules || rules.length === 0) return contacts;
  return contacts.filter((c) => rules.every((r) => matchesRule(c, r)));
}

// The same rules applied to rows straight from an imported file, where
// `field` is the file's column header as-is.
function filterRows(rows, rules) {
  if (!rules || rules.length === 0) return rows;
  return rows.filter((row) => rules.every((r) => matchesValue(row[r.field], r)));
}

// Contacts removed on the Contacts page stay in the store, so the mailings
// they were already part of keep their names and member IDs, and a re-import
// of the list recognizes them instead of adding them back. Everything that
// picks contacts for something new looks only at these.
function activeContacts(contacts) {
  return contacts.filter((c) => !c.removedAt);
}

// Every field a mailing can filter on: the known core fields plus every
// distinct key seen across all contacts' `extra` bags (arbitrary columns
// from the imported file).
function listFilterableFields(contacts) {
  const extraKeys = new Set();
  for (const c of contacts) {
    for (const key of Object.keys(c.extra || {})) extraKeys.add(key);
  }
  return {
    core: CORE_FIELDS,
    extra: Array.from(extraKeys).sort(),
  };
}

module.exports = { filterContacts, filterRows, activeContacts, listFilterableFields, getFieldValue };
