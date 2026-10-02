"use strict";

// A work queue for entering returned forms into the office's records
// software: pick a response on the left, read its answers on the right, then
// "Mark entered & next" to tick it off and move on to the next one.

function normalizedId(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

window.Pages.responses = {
  async render(container) {
    const mailings = await window.api.listMailings();
    // Set by the Tracking page's "View response" button.
    const preselect = window.__responsesSelect || null;
    window.__responsesSelect = null;
    let showFilter = preselect ? "all" : "not-entered";
    let mailingFilter = "";
    let searchTerm = "";
    let items = [];
    let selectedId = null;
    let detail = null;
    let loadToken = 0;

    container.innerHTML = `
      <h1>Responses</h1>
      <p class="subtitle">Work through returned forms: read each one here, enter it into our records software, then mark it entered.</p>
      <div class="responses-layout">
        <div class="panel responses-list-panel">
          <div class="field">
            <label>Mailing</label>
            <select id="resp-mailing">
              <option value="">All mailings</option>
              ${mailings.map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>Show</label>
            <select id="resp-show">
              <option value="not-entered">Not yet entered</option>
              <option value="all">All responses</option>
            </select>
          </div>
          <div class="field">
            <label>Search</label>
            <input type="text" id="resp-search" placeholder="Name or ID…" />
          </div>
          <div class="hint" id="resp-count" style="margin:0 0 8px"></div>
          <div class="responses-list" id="resp-list"></div>
        </div>
        <div class="panel responses-detail" id="resp-detail"></div>
      </div>
    `;
    qs("#resp-show", container).value = showFilter;

    function shownItems() {
      return items.filter((item) => {
        if (mailingFilter && item.mailingId !== mailingFilter) return false;
        if (showFilter === "not-entered" && item.enteredAt) return false;
        if (searchTerm && !`${item.name} ${item.memberId}`.toLowerCase().includes(searchTerm)) return false;
        return true;
      });
    }

    function renderList() {
      const shown = shownItems();
      const inMailing = items.filter((i) => !mailingFilter || i.mailingId === mailingFilter);
      const waiting = inMailing.filter((i) => !i.enteredAt).length;
      qs("#resp-count", container).textContent = `${waiting} of ${inMailing.length} response${inMailing.length === 1 ? "" : "s"} not yet entered`;
      const list = qs("#resp-list", container);
      list.innerHTML = shown.length
        ? shown
            .map(
              (item) => `
          <button type="button" class="resp-item ${item.recipientId === selectedId ? "selected" : ""}" data-id="${item.recipientId}">
            <span class="resp-item-name">${escapeHtml(item.name || "(no name)")}${
                item.enteredAt ? ` <span class="resp-entered-mark" title="Entered ${escapeHtml(formatDate(item.enteredAt))}">✓ entered</span>` : ""
              }</span>
            <span class="hint">${escapeHtml([item.memberId, RESPONSE_CHANNEL_LABELS[item.channel], formatDate(item.receivedAt)].filter(Boolean).join(" · "))}</span>
          </button>`
            )
            .join("")
        : `<div class="empty" style="padding:20px 0">${showFilter === "not-entered" && !searchTerm ? "All caught up — nothing waiting to be entered." : "No responses match."}</div>`;
      qsa(".resp-item", list).forEach((btn) => btn.addEventListener("click", () => select(btn.dataset.id)));
      qs(".resp-item.selected", list)?.scrollIntoView({ block: "nearest" });
    }

    // responseId picks one of the recipient's submissions; their latest
    // otherwise.
    async function select(recipientId, responseId) {
      const token = ++loadToken;
      selectedId = recipientId;
      detail = null;
      renderList();
      renderDetail();
      if (!recipientId) return;
      try {
        const loaded = await window.api.getResponse(recipientId, responseId);
        if (token !== loadToken) return;
        detail = loaded;
      } catch (err) {
        if (token !== loadToken) return;
        detail = { error: err.message };
      }
      renderDetail();
    }

    // Keeps the current selection if it's still in the list (redrawing the
    // detail so Previous/Next follow the new list); otherwise moves to the
    // first response shown.
    function ensureSelection() {
      const shown = shownItems();
      if (shown.some((i) => i.recipientId === selectedId)) {
        renderList();
        renderDetail();
        return;
      }
      select(shown[0]?.recipientId || null);
    }

    async function reloadList() {
      items = await window.api.listResponses();
    }

    function neighbor(offset) {
      const shown = shownItems();
      const idx = shown.findIndex((i) => i.recipientId === selectedId);
      return idx === -1 ? null : shown[idx + offset]?.recipientId || null;
    }

    function answersHtml(d) {
      if (!d.hasEntry) {
        const how = d.channel === "paper" ? "by mail" : d.channel === "email_pdf" ? "by email as a PDF" : "outside the web form";
        return `
          <p class="hint">This response came back ${how}, so there are no online answers to show${
            d.attachments.length ? ` — open the attached file${d.attachments.length === 1 ? "" : "s"} above` : ""
          }.</p>
          ${d.notes ? `<table class="detail-table"><tr><th>Notes</th><td>${escapeHtml(d.notes)}</td></tr></table>` : ""}`;
      }
      if (!d.answers.length) return `<p class="hint">This submission has no answers filled in.</p>`;
      return `
        ${d.labelsMissing ? `<p class="hint" style="color:var(--warn)">Couldn't load this form's questions from Gravity Forms, so answers are labeled by field number. They'll show properly after the next successful sync.</p>` : ""}
        <table class="resp-answers">
          ${d.answers
            .map((a, i) =>
              a.kind === "section"
                ? `<tr class="resp-section"><td colspan="3">${escapeHtml(a.label)}</td></tr>`
                : `<tr>
                    <th>${escapeHtml(a.label)}</th>
                    <td class="resp-answer">${
                      a.links
                        ? a.links.map((l) => `<a href="#" data-link="${escapeHtml(l.url)}">${escapeHtml(l.name)}</a>`).join("<br/>")
                        : escapeHtml(a.text)
                    }</td>
                    <td><button class="btn secondary copy-btn" data-copy-answer="${i}" type="button">Copy</button></td>
                  </tr>`
            )
            .join("")}
        </table>`;
    }

    function attachmentsHtml(d) {
      if (!d.attachments.length) return "";
      return `
        <div class="resp-files">
          <div class="label">Attached files</div>
          ${d.attachments
            .map(
              (file, i) => `
            <div class="row resp-file">
              <span>${escapeHtml(file.name)}</span>
              <span class="hint">attached ${escapeHtml(formatDate(file.addedAt))}</span>
              <button class="btn secondary copy-btn" data-open-file="${i}" type="button">Open</button>
              <button class="btn secondary copy-btn" data-remove-file="${i}" type="button">Remove</button>
            </div>`
            )
            .join("")}
        </div>`;
    }

    function renderDetail() {
      const pane = qs("#resp-detail", container);
      if (!selectedId) {
        pane.innerHTML = `<div class="empty">${items.length ? "Pick a response on the left." : "No responses yet."}</div>`;
        return;
      }
      if (!detail) {
        pane.innerHTML = `<div class="loading">Loading…</div>`;
        return;
      }
      if (detail.error) {
        pane.innerHTML = `<div class="empty">Couldn't load this response: ${escapeHtml(detail.error)}</div>`;
        return;
      }
      const d = detail;
      const prevId = neighbor(-1);
      const nextId = neighbor(1);
      const typedDifferent = d.memberIdEntered && normalizedId(d.memberIdEntered) !== normalizedId(d.memberId);
      pane.innerHTML = `
        <div class="resp-head">
          <div>
            <h2 style="margin:0 0 4px">${escapeHtml(d.name || "(no name)")}</h2>
            <div class="hint">${escapeHtml(
              [d.mailingName, RESPONSE_CHANNEL_LABELS[d.channel], d.receivedAt ? `received ${formatDate(d.receivedAt)}` : ""].filter(Boolean).join(" · ")
            )}</div>
          </div>
          <div class="resp-member-id">
            <div class="label">Member ID</div>
            <div class="row" style="gap:8px">
              <span class="resp-member-id-value">${escapeHtml(d.memberId || "—")}</span>
              ${d.memberId ? `<button class="btn secondary copy-btn" id="resp-copy-id" type="button">Copy</button>` : ""}
            </div>
          </div>
        </div>
        ${
          typedDifferent
            ? `<p class="hint resp-typed-note">On the form they typed <strong>${escapeHtml(d.memberIdEntered)}</strong>.${
                MATCHED_BY_LABELS[d.matchedBy] ? ` Matched by: ${escapeHtml(MATCHED_BY_LABELS[d.matchedBy])}.` : ""
              }</p>`
            : ""
        }
        ${
          d.previousEnteredAt && !d.enteredAt
            ? `<p class="hint resp-typed-note">They submitted again after their earlier response was entered (${escapeHtml(
                formatDate(d.previousEnteredAt)
              )}) — this newer submission hasn't been entered yet.</p>`
            : ""
        }
        ${
          d.submissions.length > 1
            ? `<p class="hint">Submitted ${d.submissions.length} times online. Showing the ${
                d.submissions[0].responseId === d.responseId ? "latest" : "earlier"
              } one, from ${escapeHtml(formatDate(d.receivedAt))}.
              ${d.submissions
                .filter((sub) => sub.responseId !== d.responseId)
                .map(
                  (sub) =>
                    `<button class="btn secondary copy-btn" data-submission="${sub.responseId}" type="button">View ${
                      sub.responseId === d.submissions[0].responseId ? "latest" : "the one"
                    } from ${escapeHtml(formatDate(sub.receivedAt))}</button>`
                )
                .join(" ")}</p>`
            : ""
        }
        <div class="row resp-actions">
          ${
            d.enteredAt
              ? `<span class="badge badge-responded">Entered ${escapeHtml(formatDate(d.enteredAt))}</span>
                 <button class="btn secondary" id="resp-unenter" type="button">Mark not entered</button>`
              : `<button class="btn" id="resp-enter" type="button">Mark entered &amp; next</button>`
          }
          <button class="btn secondary" id="resp-prev" type="button" ${prevId ? "" : "disabled"}>← Previous</button>
          <button class="btn secondary" id="resp-next" type="button" ${nextId ? "" : "disabled"}>Next →</button>
          ${d.entryUrl ? `<button class="btn secondary" id="resp-wp" type="button">View in WordPress</button>` : ""}
          ${d.responseId ? `<button class="btn secondary" id="resp-attach" type="button">Attach file…</button>` : ""}
        </div>
        ${attachmentsHtml(d)}
        ${answersHtml(d)}
      `;

      qs("#resp-copy-id", pane)?.addEventListener("click", () => copy(d.memberId));
      qsa("[data-submission]", pane).forEach((btn) => btn.addEventListener("click", () => select(d.recipientId, btn.dataset.submission)));
      qsa("[data-copy-answer]", pane).forEach((btn) => btn.addEventListener("click", () => copy(d.answers[Number(btn.dataset.copyAnswer)].text)));
      qsa("[data-link]", pane).forEach((a) =>
        a.addEventListener("click", (e) => {
          e.preventDefault();
          window.api.openExternal(a.dataset.link).catch((err) => toast(err.message, true));
        })
      );
      qs("#resp-prev", pane).addEventListener("click", () => select(prevId));
      qs("#resp-next", pane).addEventListener("click", () => select(nextId));
      qs("#resp-wp", pane)?.addEventListener("click", () => window.api.openExternal(d.entryUrl).catch((err) => toast(err.message, true)));
      qsa("[data-open-file]", pane).forEach((btn) =>
        btn.addEventListener("click", () => window.api.openPath(d.attachments[Number(btn.dataset.openFile)].path))
      );
      qsa("[data-remove-file]", pane).forEach((btn) =>
        btn.addEventListener("click", async () => {
          const file = d.attachments[Number(btn.dataset.removeFile)];
          if (!(await confirmAction(`Remove "${file.name}" from ${d.name ? `${d.name}'s` : "this"} response?`, "Remove"))) return;
          await window.api.removeAttachment(file.responseId, file.path);
          toast("File removed.");
          await select(d.recipientId, d.responseId);
        })
      );
      qs("#resp-attach", pane)?.addEventListener("click", async () => {
        const picked = await window.api.pickAttachment();
        if (!picked) return;
        try {
          const { added } = await window.api.addAttachments(d.responseId, picked);
          toast(`Attached ${added} file${added === 1 ? "" : "s"}.`);
        } catch (err) {
          toast(`Couldn't attach: ${err.message}`, true);
        }
        await select(d.recipientId, d.responseId);
      });
      qs("#resp-enter", pane)?.addEventListener("click", async () => {
        await window.api.setEntered([d.recipientId], true);
        toast(`${d.name || "Response"} marked entered.`);
        await reloadList();
        // Moves on to whatever came after this one; with "Not yet entered"
        // showing, this one drops out of the list.
        const shown = shownItems();
        await select((shown.find((i) => i.recipientId === nextId) || shown[0])?.recipientId || null);
      });
      qs("#resp-unenter", pane)?.addEventListener("click", async () => {
        if (!(await confirmAction(`Mark ${d.name || "this response"} as not entered yet? (entered ${formatDate(d.enteredAt)})`, "Not entered"))) return;
        await window.api.setEntered([d.recipientId], false);
        await reloadList();
        await select(d.recipientId);
      });
    }

    async function copy(text) {
      await window.api.copyText(text);
      toast("Copied.");
    }

    qs("#resp-mailing", container).addEventListener("change", (e) => {
      mailingFilter = e.target.value;
      ensureSelection();
    });
    qs("#resp-show", container).addEventListener("change", (e) => {
      showFilter = e.target.value;
      ensureSelection();
    });
    qs("#resp-search", container).addEventListener("input", (e) => {
      searchTerm = e.target.value.trim().toLowerCase();
      ensureSelection();
    });

    await reloadList();
    await select(items.some((i) => i.recipientId === preselect) ? preselect : shownItems()[0]?.recipientId || null);
  },
};
