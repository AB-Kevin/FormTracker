"use strict";

// Shared helpers used by every page module (renderer/pages/*.js). Each page
// module registers itself on window.Pages[name] = { render(container) }.
window.Pages = {};

function qs(sel, root = document) {
  return root.querySelector(sel);
}
function qsa(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

// Shared with mailing-new.js (the filter builder) and mailings.js (showing a
// past mailing's filters read-only), so the two stay in sync automatically.
const FILTER_OPS = [
  { value: "notEmpty", label: "is not empty" },
  { value: "empty", label: "is empty" },
  { value: "equals", label: "equals" },
  { value: "notEquals", label: "does not equal" },
  { value: "contains", label: "contains" },
  { value: "in", label: "is one of (comma-separated)" },
];
function filterOpLabel(op) {
  return FILTER_OPS.find((o) => o.value === op)?.label || op;
}
function filterRuleNeedsValue(op) {
  return op !== "empty" && op !== "notEmpty";
}

// The editable list of filter rules -- New Mailing, the Contacts page, and
// the row filter for a linked list. Edits `rules` in place; `fields` is
// [{ value, label }] or plain strings used as both; `emptyText` is shown
// with no rules, or nothing if it's blank. `onRemove` runs after a rule is
// removed.
function renderFilterRules(area, rules, fields, emptyText, onRemove) {
  const options = fields.map((f) => (typeof f === "string" ? { value: f, label: f } : f));
  if (rules.length === 0) {
    area.innerHTML = emptyText ? `<p class="hint">${escapeHtml(emptyText)}</p>` : "";
    return;
  }
  area.innerHTML = rules
    .map(
      (rule, i) => `
    <div class="filter-rule" data-idx="${i}">
      <select class="rule-field">${options
        .map((f) => `<option value="${escapeHtml(f.value)}" ${rule.field === f.value ? "selected" : ""}>${escapeHtml(f.label)}</option>`)
        .join("")}</select>
      <select class="rule-op">${FILTER_OPS.map(
        (o) => `<option value="${o.value}" ${rule.op === o.value ? "selected" : ""}>${o.label}</option>`
      ).join("")}</select>
      <input type="text" class="rule-value" value="${escapeHtml(rule.value || "")}" style="${
        filterRuleNeedsValue(rule.op) ? "" : "display:none"
      }" />
      <button class="btn danger" data-remove="${i}" type="button">Remove</button>
    </div>`
    )
    .join("");

  qsa(".filter-rule", area).forEach((rowEl) => {
    const idx = Number(rowEl.dataset.idx);
    qs(".rule-field", rowEl).addEventListener("change", (e) => (rules[idx].field = e.target.value));
    qs(".rule-op", rowEl).addEventListener("change", (e) => {
      rules[idx].op = e.target.value;
      qs(".rule-value", rowEl).style.display = filterRuleNeedsValue(e.target.value) ? "" : "none";
    });
    qs(".rule-value", rowEl).addEventListener("input", (e) => (rules[idx].value = e.target.value));
  });
  qsa("[data-remove]", area).forEach((btn) =>
    btn.addEventListener("click", () => {
      rules.splice(Number(btn.dataset.remove), 1);
      renderFilterRules(area, rules, fields, emptyText, onRemove);
      onRemove?.();
    })
  );
}

// Shared by tracking.js and responses.js.
const RESPONSE_CHANNEL_LABELS = { web: "Web form", email_pdf: "Emailed PDF", paper: "Mailed back" };
const MATCHED_BY_LABELS = {
  token: "Personalized link",
  memberId: "Member ID",
  memberIdLookalike: "Member ID (look-alike characters, e.g. O for 0)",
  manual: "Matched by hand",
};

// "1 change", "3 changes".
function plural(n, one, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function toast(message, isError = false) {
  const container = qs("#toast");
  const item = document.createElement("div");
  item.className = "toast-item" + (isError ? " toast-error" : "");
  // A main-process error arrives as "Error invoking remote method 'x':
  // Error: <message>" -- only the message means anything to the user.
  item.textContent = String(message).replace(/Error invoking remote method '[^']*': (?:\w*Error: )?/g, "");
  container.appendChild(item);
  setTimeout(() => item.classList.add("visible"), 10);
  setTimeout(() => {
    item.classList.remove("visible");
    setTimeout(() => item.remove(), 300);
  }, 4000);
}

// Always use this instead of window.confirm() -- see "dialog:confirm" in
// main.js for why the built-in one breaks form controls afterwards.
function confirmAction(message, okLabel) {
  return window.api.confirm(message, okLabel);
}

async function navigate(pageName) {
  qsa(".nav-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.page === pageName));
  document.dispatchEvent(new CustomEvent("formtracker:navigate", { detail: pageName }));
  const content = qs("#content");
  content.innerHTML = '<div class="loading">Loading…</div>';
  const page = window.Pages[pageName];
  if (!page) {
    content.innerHTML = `<div class="empty">Unknown page: ${escapeHtml(pageName)}</div>`;
    return;
  }
  try {
    await page.render(content);
  } catch (err) {
    console.error(err);
    content.innerHTML = `<div class="empty">Something went wrong: ${escapeHtml(err.message)}</div>`;
  }
}

window.navigate = navigate;
window.toast = toast;
window.confirmAction = confirmAction;
window.escapeHtml = escapeHtml;
window.formatDate = formatDate;
window.plural = plural;
window.FILTER_OPS = FILTER_OPS;
window.RESPONSE_CHANNEL_LABELS = RESPONSE_CHANNEL_LABELS;
window.MATCHED_BY_LABELS = MATCHED_BY_LABELS;
window.filterOpLabel = filterOpLabel;
window.filterRuleNeedsValue = filterRuleNeedsValue;
window.renderFilterRules = renderFilterRules;
