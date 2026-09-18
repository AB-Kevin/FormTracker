"use strict";

// Gravity Forms REST API v2 supports HTTP Basic Auth over HTTPS as an
// alternative to full OAuth1 request signing (consumer key as username,
// consumer secret as password) -- see docs.gravityforms.com. Basic Auth is
// enough here since FormTracker only ever talks to a site Kevin configures
// himself, and avoids implementing OAuth1 signing for no real benefit. This
// mirrors the same approach already used in the sibling ApplicationManager
// project's main.js (gfFetch).
async function gfFetch(siteUrl, consumerKey, consumerSecret, endpoint) {
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
  const base = siteUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/wp-json/gf/v2/${endpoint}`, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Gravity Forms API error ${res.status} for ${endpoint} -- check the site URL and key/secret.`);
  }
  return res.json();
}

async function testConnection(siteUrl, consumerKey, consumerSecret) {
  const forms = await gfFetch(siteUrl, consumerKey, consumerSecret, "forms");
  const list = Array.isArray(forms) ? forms : Object.values(forms || {});
  return list.map((f) => ({ id: String(f.id), title: f.title || `Form ${f.id}` }));
}

// The exact list-entries response envelope varies by GF version -- accepts
// either a bare array or an {entries, total_count} wrapper.
function normalizeEntriesResponse(raw) {
  if (Array.isArray(raw)) return { entries: raw, totalCount: raw.length };
  if (raw && Array.isArray(raw.entries)) {
    return { entries: raw.entries, totalCount: Number(raw.total_count) || raw.entries.length };
  }
  return { entries: [], totalCount: 0 };
}

async function fetchEntries(gravityForm) {
  const raw = await gfFetch(
    gravityForm.siteUrl,
    gravityForm.consumerKey,
    gravityForm.consumerSecret,
    `forms/${gravityForm.formId}/entries?paging[page_size]=200&sorting[key]=date_created&sorting[direction]=DESC`
  );
  return normalizeEntriesResponse(raw).entries;
}

// Matches freshly-fetched Gravity Forms entries against pending
// mailing_recipients by the value of the hidden token field (identified by
// gravityForm.tokenFieldId), skipping any entry already recorded as a
// response (by gf entry id) so a repeated sync never double-counts.
function matchEntriesToRecipients(entries, gravityForm, recipients, alreadySyncedEntryIds) {
  const seen = new Set(alreadySyncedEntryIds);
  const byToken = new Map(recipients.map((r) => [r.responseToken, r]));
  const matches = [];
  for (const entry of entries) {
    const entryId = String(entry.id);
    if (seen.has(entryId)) continue;
    const token = entry[String(gravityForm.tokenFieldId)];
    if (!token) continue;
    const recipient = byToken.get(String(token).trim());
    if (!recipient) continue;
    matches.push({ recipient, entry, entryId });
  }
  return matches;
}

module.exports = { gfFetch, testConnection, fetchEntries, matchEntriesToRecipients };
