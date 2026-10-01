"use strict";

// Turns a raw Gravity Forms entry (values keyed by field ID, e.g. "5", "1.3")
// into the labeled answers shown on the Responses page, using the form's own
// field definitions. Covers the field types a typical form uses; anything
// else falls back to showing its stored value as-is.

// Only the parts of a form definition the Responses page needs -- the full
// form object also carries notifications, confirmations, styling, etc.
function trimFormFields(form) {
  const fields = Array.isArray(form?.fields) ? form.fields : [];
  return fields.map((f) => ({
    id: f.id,
    type: f.type,
    inputType: f.inputType,
    label: f.label,
    adminLabel: f.adminLabel,
    inputs: Array.isArray(f.inputs) ? f.inputs.map((i) => ({ id: String(i.id), label: i.label })) : null,
    choices: Array.isArray(f.choices) ? f.choices.map((c) => ({ text: c.text, value: c.value })) : null,
    enableColumns: !!f.enableColumns,
  }));
}

// Gravity Forms stores List field values PHP-serialized (e.g.
// a:2:{i:0;s:4:"Mary";i:1;s:4:"John";}). Parses just what a List field
// uses -- arrays, strings, numbers -- and returns null for anything else so
// the raw value is shown instead. String lengths are in UTF-8 bytes, hence
// working on a Buffer.
function phpUnserialize(text) {
  const buf = Buffer.from(String(text), "utf8");
  let pos = 0;
  const readUntil = (ch) => {
    const end = buf.indexOf(ch, pos);
    if (end === -1) throw new Error("truncated");
    const value = buf.toString("utf8", pos, end);
    pos = end + 1;
    return value;
  };
  function read() {
    const type = String.fromCharCode(buf[pos]);
    pos += 2; // type letter and ":" (or ";" for N)
    if (type === "N") return null;
    if (type === "i" || type === "d") return Number(readUntil(";"));
    if (type === "b") return readUntil(";") === "1";
    if (type === "s") {
      const length = Number(readUntil(":"));
      pos += 1; // opening quote
      const value = buf.toString("utf8", pos, pos + length);
      pos += length + 2; // closing quote and ";"
      return value;
    }
    if (type === "a") {
      const count = Number(readUntil(":"));
      pos += 1; // "{"
      const pairs = [];
      for (let i = 0; i < count; i++) pairs.push([read(), read()]);
      pos += 1; // "}"
      return pairs.every(([key], i) => key === i) ? pairs.map(([, v]) => v) : Object.fromEntries(pairs);
    }
    throw new Error(`unsupported type ${type}`);
  }
  try {
    const value = read();
    return pos === buf.length ? value : null;
  } catch {
    return null;
  }
}

function parseJsonArray(text) {
  if (!/^\s*\[/.test(text)) return null;
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

// Choice fields can store a separate "value" from the text the person saw;
// show the text.
function choiceText(field, value) {
  const choice = field.choices?.find((c) => String(c.value) === String(value));
  return choice && choice.text ? choice.text : String(value);
}

function str(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function fileName(url) {
  const last = url.split("/").pop() || url;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

function sub(entry, field, suffix) {
  return str(entry[`${field.id}.${suffix}`]);
}

// Returns { text, links } for one field, or null when it has no answer.
function fieldAnswer(entry, field) {
  const own = str(entry[String(field.id)]);
  const type = field.inputType || field.type;

  if (field.type === "name") {
    const text = own || ["2", "3", "4", "6", "8"].map((s) => sub(entry, field, s)).filter(Boolean).join(" ");
    return text ? { text } : null;
  }
  if (field.type === "address") {
    const cityLine = [sub(entry, field, "3"), [sub(entry, field, "4"), sub(entry, field, "5")].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", ");
    const lines = [sub(entry, field, "1"), sub(entry, field, "2"), cityLine, sub(entry, field, "6")].filter(Boolean);
    return lines.length ? { text: lines.join("\n") } : null;
  }
  if (field.type === "consent") {
    return sub(entry, field, "1") ? { text: "Agreed" } : null;
  }
  if (type === "checkbox") {
    const picked = (field.inputs || []).map((i) => str(entry[i.id])).filter(Boolean);
    return picked.length ? { text: picked.map((v) => choiceText(field, v)).join("\n") } : null;
  }
  if (type === "multiselect") {
    if (!own) return null;
    const values = parseJsonArray(own) || own.split(",");
    return { text: values.map((v) => choiceText(field, str(v))).filter(Boolean).join("\n") };
  }
  if (field.type === "fileupload") {
    if (!own) return null;
    const urls = (parseJsonArray(own) || [own]).map(str).filter(Boolean);
    return { text: urls.join("\n"), links: urls.map((url) => ({ url, name: fileName(url) })) };
  }
  if (field.type === "list") {
    if (!own) return null;
    const rows = Array.isArray(entry[String(field.id)]) ? entry[String(field.id)] : phpUnserialize(own);
    if (!Array.isArray(rows)) return { text: own };
    const lines = rows
      .map((row) =>
        row && typeof row === "object"
          ? Object.entries(row)
              .filter(([, v]) => str(v))
              .map(([k, v]) => `${k}: ${str(v)}`)
              .join(" · ")
          : str(row)
      )
      .filter(Boolean);
    return lines.length ? { text: lines.join("\n") } : null;
  }
  if (own) {
    return { text: field.choices ? choiceText(field, own) : own };
  }
  // Any other multi-part field: each filled-in part on its own line.
  const parts = (field.inputs || [])
    .map((i) => [i.label, str(entry[i.id])])
    .filter(([, v]) => v)
    .map(([label, v]) => (label ? `${label}: ${v}` : v));
  return parts.length ? { text: parts.join("\n") } : null;
}

const SKIPPED_TYPES = new Set(["page", "html", "captcha"]);

// The entry as a list of { kind: "section", label } and
// { kind: "field", label, text, links? } items in form order, leaving out
// unanswered fields (and sections left with nothing under them). Without
// field definitions, falls back to every stored field value labeled by ID.
function describeEntry(entry, fields, { skipFieldIds = [] } = {}) {
  const skip = new Set(skipFieldIds.filter(Boolean).map(String));
  if (!Array.isArray(fields) || fields.length === 0) {
    return Object.keys(entry || {})
      .filter((key) => /^\d+(\.\d+)?$/.test(key) && !skip.has(key.split(".")[0]) && str(entry[key]))
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => ({ kind: "field", label: `Field ${key}`, text: str(entry[key]) }));
  }

  const items = [];
  for (const field of fields) {
    if (SKIPPED_TYPES.has(field.type) || skip.has(String(field.id))) continue;
    const label = str(field.label) || str(field.adminLabel) || `Field ${field.id}`;
    if (field.type === "section") {
      items.push({ kind: "section", label });
      continue;
    }
    const answer = fieldAnswer(entry || {}, field);
    if (answer) items.push({ kind: "field", label, ...answer });
  }
  return items.filter((item, i) => item.kind !== "section" || items[i + 1]?.kind === "field");
}

module.exports = { trimFormFields, describeEntry, phpUnserialize };
