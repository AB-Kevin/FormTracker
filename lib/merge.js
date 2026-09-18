"use strict";

// Replaces {{field}} placeholders in a template string against one contact
// record. Looks up top-level contact fields first (name, email, addressLine1,
// ...), then falls back to contact.extra[field] so any column pulled in from
// the source CSV/spreadsheet -- not just the core fields FormTracker knows by
// name -- can be used in a template without an "extra." prefix. A field that
// resolves to nothing is left blank rather than left as a literal
// "{{field}}", since author intent for a missing value (blank address line
// 2, for instance) is almost always "leave it out".
function renderTemplate(templateStr, contact, extraContext = {}) {
  return String(templateStr || "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, rawField) => {
    if (rawField in extraContext) return String(extraContext[rawField]);
    if (rawField.startsWith("extra.")) {
      const key = rawField.slice("extra.".length);
      return String(contact.extra?.[key] ?? "");
    }
    if (rawField in contact && typeof contact[rawField] !== "object") {
      return String(contact[rawField] ?? "");
    }
    return String(contact.extra?.[rawField] ?? "");
  });
}

// Builds the personalized Gravity Forms link for one recipient: the form's
// public page URL plus the hidden token field's dynamic-population
// parameter, carrying this recipient's response token.
function buildResponseLink(gravityForm, token) {
  const url = new URL(gravityForm.pageUrl);
  url.searchParams.set(gravityForm.tokenParamName || "rtoken", token);
  return url.toString();
}

module.exports = { renderTemplate, buildResponseLink };
