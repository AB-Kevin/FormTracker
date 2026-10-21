"use strict";

const { filterRows, getFieldValue } = require("./filter");

// Adds fields to the contacts already imported from a second file that
// lists them differently -- e.g. a list of every individual member, with
// birthdates, next to a contact list of households. Each contact is linked to
// a row of the file by a shared ID (a contact field and a file column, both
// chosen by the user); row filters narrow the file to the rows that stand for
// a contact (just the heads of household, say) first. Nothing is added as a
// new contact: the contact list stays whatever the main import made it.

// IDs are compared ignoring case and surrounding spaces, and an all-digit ID
// ignoring leading zeros -- one file keeping "00123" as text while the other
// was a spreadsheet that turned it into the number 123 is common.
function normalizeKey(value) {
  const s = String(value ?? "").trim().toUpperCase();
  return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, "") : s;
}

function validDate(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return { y, m, d };
}

// A birthdate as { y, m, d }, or null if it can't be read. Spreadsheet date
// cells arrive as Excel day numbers; text is read as YYYY-MM-DD, YYYYMMDD,
// or the US order M/D/YYYY. A two-digit year is taken as the most recent one
// that isn't in the future.
function parseDate(value, today = new Date()) {
  if (typeof value === "number") {
    if (value < 1 || value > 2958465) return null;
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
    return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
  }
  const s = String(value ?? "").trim();
  let match;
  if ((match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/))) {
    return validDate(Number(match[1]), Number(match[2]), Number(match[3]));
  }
  if ((match = s.match(/^(\d{4})(\d{2})(\d{2})$/))) {
    return validDate(Number(match[1]), Number(match[2]), Number(match[3]));
  }
  if ((match = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:$|\s)/))) {
    let y = Number(match[3]);
    if (match[3].length === 2) {
      const century = Math.floor(today.getFullYear() / 100) * 100;
      y += y > today.getFullYear() % 100 ? century - 100 : century;
    }
    return validDate(y, Number(match[1]), Number(match[2]));
  }
  return null;
}

// Whole years old on `asOf` (a local Date); null for a birthdate after it.
function ageOn(birth, asOf) {
  const y = asOf.getFullYear();
  const m = asOf.getMonth() + 1;
  const d = asOf.getDate();
  let age = y - birth.y;
  if (m < birth.m || (m === birth.m && d < birth.d)) age--;
  return age < 0 ? null : age;
}

// config: {
//   contactKey   contact field holding the shared ID ("externalId" or an
//                imported column, as "extra.<column>")
//   fileKey      the file's column holding the same ID
//   rowRules     filter rules on the file's columns; only matching rows count
//   age          { birthdateColumn, minAge, fieldName } or null -- sets
//                fieldName to "Yes"/"No" by whether the linked row's person
//                is at least minAge today
//   copyColumns  file columns copied onto the contact under the same name
// }
// `rows` are the file's rows as displayed text and `rawRows` the same rows
// with spreadsheet dates still as day numbers (see csvImport.parseFile).
//
// Every contact gets every field, blank when it has no linked row (or its
// birthdate can't be read), so running this again after the file changes
// leaves no value from the last run behind.
function planFieldImport(contacts, rows, rawRows, config, today = new Date()) {
  const { contactKey, fileKey, rowRules = [], age = null, copyColumns = [] } = config;
  if (!contactKey || !fileKey) throw new Error("Choose the ID column in both lists that links them.");
  if (age && !age.fieldName?.trim()) throw new Error("Give the age field a name.");
  if (age && !age.birthdateColumn) throw new Error("Choose the birthdate column.");
  if (age && !(Number(age.minAge) > 0)) throw new Error("Enter the age to compare against.");
  if (!age && copyColumns.length === 0) throw new Error("Choose at least one field to add.");

  const rawByRow = new Map(rows.map((row, i) => [row, rawRows[i]]));
  const usedRows = filterRows(rows, rowRules);
  const rowsByKey = new Map();
  for (const row of usedRows) {
    const key = normalizeKey(row[fileKey]);
    if (!key) continue;
    if (!rowsByKey.has(key)) rowsByKey.set(key, []);
    rowsByKey.get(key).push(row);
  }

  const ageField = age ? age.fieldName.trim() : null;
  const stats = {
    fileRows: rows.length,
    usedRows: usedRows.length,
    contacts: contacts.length,
    matched: 0,
    unmatched: [],
    multiple: [],
    unreadableBirthdates: [],
    ageYes: 0,
    ageNo: 0,
    unusedRows: 0,
  };
  const updates = new Map();
  const linkedKeys = new Set();

  for (const contact of contacts) {
    const key = normalizeKey(getFieldValue(contact, contactKey));
    const linked = (key && rowsByKey.get(key)) || [];
    const row = linked[0];
    const label = contact.name || contact.externalId || "(no name)";
    if (row) {
      stats.matched++;
      linkedKeys.add(key);
      if (linked.length > 1) stats.multiple.push({ name: label, count: linked.length });
    } else {
      stats.unmatched.push(label);
    }

    const fields = {};
    if (age) {
      fields[ageField] = "";
      if (row) {
        const raw = rawByRow.get(row)?.[age.birthdateColumn];
        const birth = parseDate(raw ?? row[age.birthdateColumn], today);
        const years = birth ? ageOn(birth, today) : null;
        if (years === null) {
          stats.unreadableBirthdates.push({ name: label, value: String(row[age.birthdateColumn] ?? "") });
        } else if (years >= Number(age.minAge)) {
          fields[ageField] = "Yes";
          stats.ageYes++;
        } else {
          fields[ageField] = "No";
          stats.ageNo++;
        }
      }
    }
    for (const column of copyColumns) fields[column] = row ? String(row[column] ?? "").trim() : "";
    updates.set(contact.id, fields);
  }

  stats.unusedRows = [...rowsByKey.keys()].filter((key) => !linkedKeys.has(key)).length;
  return { updates, stats, fieldNames: [...(ageField ? [ageField] : []), ...copyColumns] };
}

module.exports = { planFieldImport, parseDate, ageOn, normalizeKey };
