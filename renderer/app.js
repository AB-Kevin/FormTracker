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
  { value: "contains", label: "contains" },
  { value: "in", label: "is one of (comma-separated)" },
];
function filterOpLabel(op) {
  return FILTER_OPS.find((o) => o.value === op)?.label || op;
}
function filterRuleNeedsValue(op) {
  return op !== "empty" && op !== "notEmpty";
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
  item.textContent = message;
  container.appendChild(item);
  setTimeout(() => item.classList.add("visible"), 10);
  setTimeout(() => {
    item.classList.remove("visible");
    setTimeout(() => item.remove(), 300);
  }, 4000);
}

async function navigate(pageName) {
  qsa(".nav-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.page === pageName));
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
window.escapeHtml = escapeHtml;
window.formatDate = formatDate;
window.FILTER_OPS = FILTER_OPS;
window.filterOpLabel = filterOpLabel;
window.filterRuleNeedsValue = filterRuleNeedsValue;
