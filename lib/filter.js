"use strict";

const { CORE_FIELDS } = require("./csvImport");

function getFieldValue(contact, field) {
  if (field.startsWith("extra.")) return contact.extra?.[field.slice("extra.".length)];
  if (CORE_FIELDS.includes(field)) return contact[field];
  return contact.extra?.[field];
}

function matchesRule(contact, rule) {
  const value = String(getFieldValue(contact, rule.field) ?? "").toLowerCase();
  const target = String(rule.value ?? "").toLowerCase();
  switch (rule.op) {
    case "equals":
      return value === target;
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

module.exports = { filterContacts, listFilterableFields, getFieldValue };
