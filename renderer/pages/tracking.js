"use strict";

function statusBadge(row) {
  if (row.status === "responded") {
    const via = row.response ? row.response.channel : "";
    const label = RESPONSE_CHANNEL_LABELS[via] || "Responded";
    return `<span class="badge badge-responded">${escapeHtml(label)}</span>`;
  }
  if (row.channel === "paper") {
    if (row.mailedAt) return `<span class="badge badge-sent">Mailed — no reply</span>`;
    if (row.status === "sent") return `<span class="badge badge-pending">Letter ready — not mailed</span>`;
  }
  if (row.status === "sent") return `<span class="badge badge-sent">Sent — no reply</span>`;
  if (isSendFailed(row)) return `<span class="badge badge-failed">Send failed</span>`;
  return `<span class="badge badge-pending">Pending</span>`;
}

// A paper recipient whose physical copy hasn't been marked as mailed yet.
function canMarkMailed(row) {
  return row.channel === "paper" && row.status !== "responded" && !row.mailedAt;
}

// Sending to this recipient was attempted and failed (bad address, rejected
// by the mail server, ...) -- they're still waiting to be sent.
function isSendFailed(row) {
  return row.status === "pending" && !!row.error;
}

// Responded, but the response hasn't been entered into the office's records
// software yet.
function needsEntering(row) {
  return row.status === "responded" && !row.enteredAt;
}

window.Pages.tracking = {
  async render(container) {
    const mailings = await window.api.listMailings();
    const preselect = window.__trackingMailingFilter || "";
    window.__trackingMailingFilter = null;
    const preselectStatus = window.__trackingStatusFilter || "all";
    window.__trackingStatusFilter = null;
    let statusFilter = preselectStatus;
    let channelFilter = "all";
    let mailingFilter = preselect;
    let searchTerm = "";
    let rows = [];
    let expandedId = null;
    let review = { items: [], choices: {} };

    container.innerHTML = `
      <h1>Tracking</h1>
      <p class="subtitle">Every recipient, how they were reached, and whether they've replied.</p>

      <div class="stat-row" id="stat-row"></div>

      <div class="panel" id="review-panel" style="display:none">
        <h2 style="margin-top:0">Online responses to match</h2>
        <p class="hint" style="margin-top:0">These Gravity Forms entries couldn't be matched to a recipient automatically — usually a mistyped member ID.
          Choose who each one is from, or dismiss it if it isn't a response to a mailing (a test entry, a duplicate).</p>
        <p class="hint" id="review-setup-hint" style="display:none;color:var(--warn)">Some of these forms don't have a Member ID field set up yet, so their entries can't be matched by member ID.
          Set it on the Gravity Forms page (edit the connection) and sync again.</p>
        <table>
          <thead><tr><th>Submitted</th><th>Form</th><th>Member ID entered</th><th>Name / email on the form</th><th></th></tr></thead>
          <tbody id="review-rows"></tbody>
        </table>
      </div>

      <div class="panel">
        <div class="row">
          <div class="field">
            <label>Mailing</label>
            <select id="mailing-filter">
              <option value="">All mailings</option>
              ${mailings.map((m) => `<option value="${m.id}" ${m.id === preselect ? "selected" : ""}>${escapeHtml(m.name)}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>Status</label>
            <select id="status-filter">
              <option value="all">All</option>
              <option value="not-responded">Not yet responded</option>
              <option value="responded">Responded</option>
              <option value="not-entered">Responded — not yet entered</option>
              <option value="entered">Entered</option>
              <option value="not-mailed">Paper not yet mailed</option>
              <option value="failed">Send failed</option>
            </select>
          </div>
          <div class="field">
            <label>Channel</label>
            <select id="channel-filter">
              <option value="all">All</option>
              <option value="paper">Paper</option>
              <option value="email">Email</option>
            </select>
          </div>
          <div class="field" style="flex:1">
            <label>Search</label>
            <input type="text" id="search-box" placeholder="Name, email, or ID…" />
          </div>
          <button class="btn secondary" id="sync-btn" type="button" style="align-self:flex-end;margin-bottom:12px">Sync Gravity Forms now</button>
          <button class="btn secondary" id="export-csv-btn" type="button" style="align-self:flex-end;margin-bottom:12px">Export CSV</button>
          <button class="btn secondary" id="export-xlsx-btn" type="button" style="align-self:flex-end;margin-bottom:12px">Export Excel</button>
          <button class="btn secondary" id="export-paper-btn" type="button" style="align-self:flex-end;margin-bottom:12px">Export Paper Addresses (CSV)</button>
          <button class="btn" id="mark-batch-btn" type="button" style="align-self:flex-end;margin-bottom:12px;display:none"></button>
        </div>
        <table>
          <thead><tr><th>Name</th><th>Channel</th><th>Mailing</th><th>Sent</th><th>Status</th><th title="Entered into our records software">Entered</th><th></th></tr></thead>
          <tbody id="tracking-rows"></tbody>
        </table>
        <div id="tracking-empty" class="empty" style="display:none">No recipients match these filters.</div>
      </div>
    `;

    qs("#status-filter", container).value = statusFilter;

    async function reload() {
      [rows, review] = await Promise.all([window.api.listTracking(mailingFilter || undefined), window.api.listGfReview()]);
      renderAll();
    }

    function filteredRows() {
      return rows.filter((r) => {
        if (statusFilter === "responded" && r.status !== "responded") return false;
        if (statusFilter === "not-responded" && r.status === "responded") return false;
        if (statusFilter === "not-entered" && !needsEntering(r)) return false;
        if (statusFilter === "entered" && !r.enteredAt) return false;
        if (statusFilter === "not-mailed" && !canMarkMailed(r)) return false;
        if (statusFilter === "failed" && !isSendFailed(r)) return false;
        if (channelFilter !== "all" && r.channel !== channelFilter) return false;
        if (searchTerm) {
          const hay = `${r.contact?.name || ""} ${r.contact?.email || ""} ${r.contact?.externalId || ""}`.toLowerCase();
          if (!hay.includes(searchTerm)) return false;
        }
        return true;
      });
    }

    function renderStats() {
      const total = rows.length;
      const responded = rows.filter((r) => r.status === "responded").length;
      const hasPaper = rows.some((r) => r.channel === "paper");
      const notMailed = rows.filter(canMarkMailed).length;
      const failed = rows.filter(isSendFailed).length;
      const notEntered = rows.filter(needsEntering).length;
      qs("#stat-row", container).innerHTML = `
        <div class="stat-card"><div class="num">${total}</div><div class="label">Total recipients</div></div>
        <div class="stat-card"><div class="num">${responded}</div><div class="label">Responded</div></div>
        ${responded ? `<div class="stat-card"><div class="num">${notEntered}</div><div class="label">Responded, not yet entered</div></div>` : ""}
        <div class="stat-card"><div class="num">${total - responded}</div><div class="label">Not yet responded</div></div>
        ${hasPaper ? `<div class="stat-card"><div class="num">${notMailed}</div><div class="label">Paper not yet mailed</div></div>` : ""}
        ${failed ? `<div class="stat-card stat-card-failed"><div class="num">${failed}</div><div class="label">Send failed</div></div>` : ""}
      `;
    }

    // Entries from the form(s) behind the selected mailing, or all of them.
    function reviewItemsShown() {
      if (!mailingFilter) return review.items;
      const gfId = mailings.find((m) => m.id === mailingFilter)?.gravityFormId;
      return review.items.filter((item) => item.gravityFormId === gfId);
    }

    function choiceLabel(choice) {
      return `${choice.name || "(no name)"}${choice.memberId ? ` · ${choice.memberId}` : ""}${choice.mailingName ? ` — ${choice.mailingName}` : ""}${
        choice.responded ? " (already responded)" : ""
      }`;
    }

    function renderReview() {
      const items = reviewItemsShown();
      qs("#review-panel", container).style.display = items.length ? "" : "none";
      qs("#review-setup-hint", container).style.display = items.some((i) => !i.memberIdFieldSet) ? "" : "none";
      const body = qs("#review-rows", container);
      body.innerHTML = items
        .map(
          (item) => `
        <tr>
          <td>${formatDate(item.submittedAt)}</td>
          <td>${escapeHtml(item.formName)}</td>
          <td>${
            item.memberIdEntered
              ? `<strong>${escapeHtml(item.memberIdEntered)}</strong>`
              : `<span class="hint">${item.memberIdFieldSet ? "(blank)" : "(field not set up)"}</span>`
          }</td>
          <td>${escapeHtml(item.name)}<br/><span class="hint">${escapeHtml(item.email)}</span></td>
          <td>
            ${item.suggestions
              .map(
                (s) =>
                  `<button class="btn" data-assign="${item.id}" data-recipient="${s.recipientId}" type="button">Match to ${escapeHtml(choiceLabel(s))}</button>`
              )
              .join(" ")}
            <button class="btn secondary" data-choose="${item.id}" type="button">Choose member…</button>
            <button class="btn secondary" data-entry-url="${escapeHtml(item.entryUrl)}" type="button">View entry</button>
            <button class="btn secondary" data-dismiss="${item.id}" type="button">Dismiss</button>
          </td>
        </tr>
        <tr id="choose-row-${item.id}" style="display:none"><td colspan="5"></td></tr>`
        )
        .join("");

      qsa("[data-assign]", body).forEach((btn) => btn.addEventListener("click", () => assignReview(btn.dataset.assign, btn.dataset.recipient)));
      qsa("[data-choose]", body).forEach((btn) => btn.addEventListener("click", () => openChooser(btn.dataset.choose)));
      qsa("[data-entry-url]", body).forEach((btn) =>
        btn.addEventListener("click", () => window.api.openExternal(btn.dataset.entryUrl).catch((err) => toast(err.message, true)))
      );
      qsa("[data-dismiss]", body).forEach((btn) =>
        btn.addEventListener("click", async () => {
          if (!(await confirmAction("Dismiss this entry? It won't be counted as anyone's response.", "Dismiss"))) return;
          await window.api.dismissGfReview(btn.dataset.dismiss);
          toast("Entry dismissed.");
          await reload();
        })
      );
    }

    async function assignReview(reviewId, recipientId) {
      try {
        await window.api.assignGfReview(reviewId, recipientId);
        toast("Response recorded.");
      } catch (err) {
        toast(err.message, true);
      }
      await reload();
    }

    function openChooser(reviewId) {
      const item = review.items.find((i) => i.id === reviewId);
      const choices = review.choices[item.gravityFormId] || [];
      const row = qs(`#choose-row-${reviewId}`, container);
      const cell = qs("td", row);
      row.style.display = "table-row";
      cell.innerHTML = `
        <div class="row" style="padding:8px 0;align-items:flex-start">
          <div class="field" style="flex:1">
            <label>Find the member (name or ID)</label>
            <input type="text" class="choose-search" value="${escapeHtml(item.name || "")}" />
            <select class="choose-list" size="8" style="margin-top:6px"></select>
          </div>
          <button class="btn choose-save" type="button" style="margin-top:22px">Match</button>
          <button class="btn secondary choose-cancel" type="button" style="margin-top:22px">Cancel</button>
        </div>
      `;
      const search = qs(".choose-search", cell);
      const list = qs(".choose-list", cell);
      function renderChoices() {
        // Every word has to appear somewhere, in any order, so "John
        // Stoltzfus" also finds "Stoltzfus, John".
        const words = search.value.toLowerCase().split(/[\s,]+/).filter(Boolean);
        const shown = choices
          .filter((c) => {
            const hay = `${c.name} ${c.memberId}`.toLowerCase();
            return words.every((w) => hay.includes(w));
          })
          .slice(0, 200);
        list.innerHTML = shown.map((c) => `<option value="${c.recipientId}">${escapeHtml(choiceLabel(c))}</option>`).join("");
        if (shown.length) list.selectedIndex = 0;
      }
      search.addEventListener("input", renderChoices);
      qs(".choose-cancel", cell).addEventListener("click", () => {
        row.style.display = "none";
      });
      qs(".choose-save", cell).addEventListener("click", () => {
        if (!list.value) {
          toast("Pick a member from the list first.", true);
          return;
        }
        assignReview(reviewId, list.value);
      });
      renderChoices();
      search.focus();
    }

    function detailRow(label, value) {
      if (!value) return "";
      return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
    }

    function detailHtml(r) {
      const c = r.contact;
      const extraEntries = Object.entries(c?.extra || {}).filter(([, v]) => v);
      return `
        <div class="row" style="align-items:flex-start;gap:40px;padding:12px 4px">
          <div>
            <h2 style="margin-top:0">Recipient</h2>
            <table class="detail-table">
              ${detailRow("Recipient ID", r.id)}
              ${detailRow("Contact ID", r.contactId)}
              ${detailRow("Mailing", r.mailingName)}
              ${detailRow("Channel", r.channel)}
              ${detailRow("Status", r.status)}
              ${isSendFailed(r) ? detailRow("Send error", r.error) : ""}
              ${detailRow(r.channel === "paper" ? "Letter generated at" : "Sent at", formatDate(r.sentAt))}
              ${detailRow("Mailed at", formatDate(r.mailedAt))}
              ${detailRow("Generated file", r.generatedFilePath)}
              ${detailRow("Response token", r.responseToken)}
              ${detailRow("Responded via", r.response?.channel)}
              ${detailRow("Responded at", r.response?.receivedAt ? formatDate(r.response.receivedAt) : "")}
              ${detailRow("Matched by", MATCHED_BY_LABELS[r.response?.matchedBy])}
              ${detailRow("Member ID entered", r.response?.memberIdEntered)}
              ${detailRow("Response notes", r.response?.notes)}
              ${detailRow("Entered at", formatDate(r.enteredAt))}
            </table>
            ${
              r.attachments.length
                ? `<h2>Attached files</h2>
                  <table class="detail-table">${r.attachments
                    .map(
                      (file, i) => `
                    <tr>
                      <td>${escapeHtml(file.name)}<br/><span class="hint">attached ${escapeHtml(formatDate(file.addedAt))}</span></td>
                      <td style="white-space:nowrap">
                        <button class="btn secondary" data-open="${escapeHtml(file.path)}" type="button">Open</button>
                        <button class="btn secondary" data-remove-file="${r.id}" data-file-index="${i}" type="button">Remove</button>
                      </td>
                    </tr>`
                    )
                    .join("")}</table>`
                : ""
            }
            <div class="row" style="margin-top:12px;gap:8px">
              ${r.mailedAt && r.status !== "responded" ? `<button class="btn secondary" data-unmark="${r.id}" type="button">Undo mark as sent</button>` : ""}
              <button class="btn secondary" data-remove="${r.id}" type="button">Remove from mailing</button>
            </div>
          </div>
          <div>
            <h2 style="margin-top:0">Contact</h2>
            ${
              c
                ? `<table class="detail-table">
                    ${detailRow("ID", c.externalId)}
                    ${detailRow("Name", c.name)}
                    ${detailRow("Email", c.email)}
                    ${detailRow("Address line 1", c.addressLine1)}
                    ${detailRow("Address line 2", c.addressLine2)}
                    ${detailRow("City", c.city)}
                    ${detailRow("State", c.state)}
                    ${detailRow("ZIP", c.zip)}
                    ${detailRow("Source batch", c.sourceBatch)}
                  </table>
                  ${
                    extraEntries.length
                      ? `<h2>Extra fields from import</h2><table class="detail-table">${extraEntries
                          .map(([k, v]) => detailRow(k, v))
                          .join("")}</table>`
                      : ""
                  }`
                : `<p class="hint">No contact record matches contact ID "${escapeHtml(r.contactId || "")}" — it was likely deleted or re-imported after this mailing was created. That's why name/address are blank for this recipient.</p>`
            }
          </div>
        </div>
      `;
    }

    function renderTable() {
      const list = filteredRows();
      const body = qs("#tracking-rows", container);
      qs("#tracking-empty", container).style.display = list.length ? "none" : "block";
      body.innerHTML = list
        .map(
          (r) => `
        <tr class="tracking-row" data-row="${r.id}">
          <td>${escapeHtml(r.contact?.name || "")}<br/><span class="hint">${escapeHtml(r.contact?.email || "")}</span></td>
          <td><span class="badge ${r.channel === "email" ? "badge-email" : "badge-paper"}">${r.channel}</span></td>
          <td>${escapeHtml(r.mailingName)}</td>
          <td>${formatDate(r.channel === "paper" ? r.mailedAt : r.sentAt)}</td>
          <td>${statusBadge(r)}${
            isSendFailed(r) ? `<br/><span class="hint send-error" title="${escapeHtml(r.error)}">${escapeHtml(r.error)}</span>` : ""
          }</td>
          <td>${
            r.status === "responded"
              ? `<label class="entered-check"><input type="checkbox" data-entered="${r.id}" ${r.enteredAt ? "checked" : ""} />${
                  r.enteredAt ? `<span class="hint">${formatDate(r.enteredAt)}</span>` : ""
                }</label>`
              : ""
          }</td>
          <td>
            ${isSendFailed(r) ? `<button class="btn" data-retry="${r.id}" type="button">Fix &amp; resend…</button>` : ""}
            ${canMarkMailed(r) ? `<button class="btn secondary" data-mailed="${r.id}" type="button">Mark as sent</button>` : ""}
            ${r.status === "responded" ? `<button class="btn secondary" data-view-response="${r.id}" type="button">View response</button>` : ""}
            ${
              r.status !== "responded"
                ? `<button class="btn secondary" data-mark="${r.id}" type="button">Mark received…</button>`
                : r.attachments.length === 1
                ? `<button class="btn secondary" data-open="${escapeHtml(r.attachments[0].path)}" type="button">Open file</button>`
                : r.attachments.length
                ? `<button class="btn secondary" data-open-all="${r.id}" type="button">Open ${r.attachments.length} files</button>`
                : ""
            }
            ${r.response ? `<button class="btn secondary" data-attach="${r.id}" type="button">Attach file…</button>` : ""}
            ${r.generatedFilePath ? `<button class="btn secondary" data-open="${escapeHtml(r.generatedFilePath)}" type="button">Open letter</button>` : ""}
          </td>
        </tr>
        <tr class="mark-form-row" id="mark-form-${r.id}" style="display:none"><td colspan="7"></td></tr>
        <tr class="tracking-detail-row" id="detail-${r.id}" style="display:${expandedId === r.id ? "table-row" : "none"}">
          <td colspan="7">${expandedId === r.id ? detailHtml(r) : ""}</td>
        </tr>`
        )
        .join("");

      qsa("[data-mark]", body).forEach((btn) => btn.addEventListener("click", (e) => { e.stopPropagation(); openMarkForm(btn.dataset.mark); }));
      qsa("[data-retry]", body).forEach((btn) => btn.addEventListener("click", (e) => { e.stopPropagation(); openRetryForm(btn.dataset.retry); }));
      qsa("[data-mailed]", body).forEach((btn) =>
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          btn.disabled = true;
          await window.api.markMailed([btn.dataset.mailed]);
          toast("Marked as sent.");
          await reload();
        })
      );
      qsa("[data-unmark]", body).forEach((btn) =>
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          await window.api.unmarkMailed(btn.dataset.unmark);
          toast("No longer marked as sent.");
          await reload();
        })
      );
      qsa("[data-remove]", body).forEach((btn) =>
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const r = rows.find((row) => row.id === btn.dataset.remove);
          const who = r?.contact?.name || "this recipient";
          const warning =
            r?.status === "responded" ? "\n\nThey've already responded — their recorded response will be deleted too." : "";
          if (!(await confirmAction(`Remove ${who} from "${r?.mailingName || "this mailing"}"?${warning}\n\nThis can't be undone.`, "Remove"))) return;
          await window.api.removeRecipient(btn.dataset.remove);
          if (expandedId === btn.dataset.remove) expandedId = null;
          toast(`Removed ${who} from the mailing.`);
          await reload();
        })
      );
      qsa("[data-entered]", body).forEach((box) =>
        box.addEventListener("change", async () => {
          const r = rows.find((row) => row.id === box.dataset.entered);
          if (!box.checked) {
            const when = r?.enteredAt ? ` (entered ${formatDate(r.enteredAt)})` : "";
            if (!(await confirmAction(`Mark ${r?.contact?.name || "this response"} as not entered yet?${when}`, "Not entered"))) {
              box.checked = true;
              return;
            }
          }
          await window.api.setEntered([box.dataset.entered], box.checked);
          await reload();
        })
      );
      qsa("[data-view-response]", body).forEach((btn) =>
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          window.__responsesSelect = btn.dataset.viewResponse;
          navigate("responses");
        })
      );
      qsa("[data-open]", body).forEach((btn) => btn.addEventListener("click", (e) => { e.stopPropagation(); window.api.openPath(btn.dataset.open); }));
      qsa("[data-open-all]", body).forEach((btn) =>
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const r = rows.find((row) => row.id === btn.dataset.openAll);
          for (const file of r?.attachments || []) window.api.openPath(file.path);
        })
      );
      // For someone who has already responded, e.g. a web form submission
      // followed by an emailed PDF. Goes on their latest response.
      qsa("[data-attach]", body).forEach((btn) =>
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const r = rows.find((row) => row.id === btn.dataset.attach);
          const picked = await window.api.pickAttachment();
          if (!picked || !r?.response) return;
          try {
            const { added } = await window.api.addAttachments(r.response.id, picked);
            toast(`Attached ${added} file${added === 1 ? "" : "s"} to ${r.contact?.name ? `${r.contact.name}'s` : "their"} response.`);
          } catch (err) {
            toast(`Couldn't attach: ${err.message}`, true);
          }
          await reload();
        })
      );
      qsa("[data-remove-file]", body).forEach((btn) =>
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const r = rows.find((row) => row.id === btn.dataset.removeFile);
          const file = r?.attachments[Number(btn.dataset.fileIndex)];
          if (!file) return;
          if (!(await confirmAction(`Remove "${file.name}" from ${r.contact?.name ? `${r.contact.name}'s` : "this"} response?`, "Remove"))) return;
          await window.api.removeAttachment(file.responseId, file.path);
          toast("File removed.");
          await reload();
        })
      );
      qsa(".tracking-row", body).forEach((row) => {
        row.addEventListener("click", (e) => {
          if (e.target.closest("button, label, input")) return;
          expandedId = expandedId === row.dataset.row ? null : row.dataset.row;
          renderTable();
        });
      });

      // Batch-marking acts on exactly the rows currently shown, so filtering
      // Channel = Paper (or Status = Paper not yet mailed) and clicking this
      // marks that whole set.
      const batchBtn = qs("#mark-batch-btn", container);
      const markable = list.filter(canMarkMailed).length;
      batchBtn.style.display = markable ? "" : "none";
      batchBtn.textContent = `Mark ${markable} shown paper recipient${markable === 1 ? "" : "s"} as sent`;
    }

    function openMarkForm(recipientId) {
      const cell = qs(`#mark-form-${recipientId} td`, container);
      const row = qs(`#mark-form-${recipientId}`, container);
      row.style.display = "table-row";
      let attachmentPaths = [];
      cell.innerHTML = `
        <div class="row" style="padding:8px 0">
          <div class="field">
            <label>How did it come back?</label>
            <select class="mark-channel">
              <option value="email_pdf">Emailed PDF</option>
              <option value="paper">Mailed back (paper)</option>
            </select>
          </div>
          <div class="field" style="flex:1">
            <label>Notes (optional)</label>
            <input type="text" class="mark-notes" />
          </div>
          <button class="btn secondary mark-attach" type="button">Attach file…</button>
          <span class="hint mark-attach-name"></span>
          <button class="btn mark-save" type="button">Save</button>
          <button class="btn secondary mark-cancel" type="button">Cancel</button>
        </div>
      `;
      qs(".mark-attach", cell).addEventListener("click", async () => {
        const picked = await window.api.pickAttachment();
        if (!picked) return;
        attachmentPaths = picked;
        qs(".mark-attach-name", cell).textContent = picked.map((p) => p.split(/[\\/]/).pop()).join(", ");
      });
      qs(".mark-cancel", cell).addEventListener("click", () => {
        row.style.display = "none";
      });
      qs(".mark-save", cell).addEventListener("click", async () => {
        const channel = qs(".mark-channel", cell).value;
        const notes = qs(".mark-notes", cell).value;
        await window.api.markReceived(recipientId, { channel, notes, attachmentPaths });
        toast("Marked as received.");
        await reload();
      });
    }

    // Shares the mark-received form's row, since only one of the two is ever
    // relevant to a recipient who hasn't been sent yet.
    function openRetryForm(recipientId) {
      const r = rows.find((row) => row.id === recipientId);
      const cell = qs(`#mark-form-${recipientId} td`, container);
      const row = qs(`#mark-form-${recipientId}`, container);
      row.style.display = "table-row";
      cell.innerHTML = `
        <div class="row" style="padding:8px 0">
          <div class="field" style="flex:1">
            <label>Email address</label>
            <input type="text" class="retry-email" value="${escapeHtml(r?.contact?.email || "")}" />
          </div>
          <button class="btn retry-save" type="button" style="align-self:flex-end;margin-bottom:12px">Save &amp; resend</button>
          <button class="btn secondary retry-cancel" type="button" style="align-self:flex-end;margin-bottom:12px">Cancel</button>
        </div>
        <p class="hint" style="margin-top:0">The corrected address is saved on the contact. Leave it blank to send a paper letter instead.</p>
      `;
      qs(".retry-cancel", cell).addEventListener("click", () => {
        row.style.display = "none";
      });
      qs(".retry-save", cell).addEventListener("click", async () => {
        const btn = qs(".retry-save", cell);
        btn.disabled = true;
        btn.textContent = "Sending…";
        try {
          const { outcome } = await window.api.retrySend(recipientId, qs(".retry-email", cell).value);
          toast(outcome === "sent" ? "Email sent." : "Switched to paper — the letter is ready to open from this row.");
        } catch (err) {
          toast(`Still failing: ${err.message}`, true);
        }
        await reload();
      });
      qs(".retry-email", cell).focus();
    }

    function renderAll() {
      renderStats();
      renderReview();
      renderTable();
    }

    qs("#mailing-filter", container).addEventListener("change", async (e) => {
      mailingFilter = e.target.value;
      await reload();
    });
    qs("#status-filter", container).addEventListener("change", (e) => {
      statusFilter = e.target.value;
      renderTable();
    });
    qs("#channel-filter", container).addEventListener("change", (e) => {
      channelFilter = e.target.value;
      renderTable();
    });
    qs("#search-box", container).addEventListener("input", (e) => {
      searchTerm = e.target.value.toLowerCase();
      renderTable();
    });
    qs("#sync-btn", container).addEventListener("click", async () => {
      const btn = qs("#sync-btn", container);
      btn.disabled = true;
      btn.textContent = "Syncing…";
      try {
        const summary = await window.api.runSync();
        toast(
          `Sync complete — ${summary.matched} new response(s) matched` +
            (summary.needsReview ? `, ${summary.needsReview} to match by hand.` : ".")
        );
        for (const error of summary.errors) toast(`Sync problem — ${error}`, true);
        await reload();
      } catch (err) {
        toast(`Sync failed: ${err.message}`, true);
      }
      btn.disabled = false;
      btn.textContent = "Sync Gravity Forms now";
    });
    qs("#mark-batch-btn", container).addEventListener("click", async () => {
      const ids = filteredRows().filter(canMarkMailed).map((r) => r.id);
      if (!ids.length) return;
      if (!(await confirmAction(`Mark ${ids.length} paper recipient${ids.length === 1 ? "" : "s"} as sent (mailed today)?`, "Mark as sent"))) return;
      const { updated } = await window.api.markMailed(ids);
      toast(`Marked ${updated} recipient${updated === 1 ? "" : "s"} as sent.`);
      await reload();
    });
    // Exports cover exactly the rows currently shown (all filters + search).
    async function exportShown(exportFn, onlyPaper) {
      const shown = filteredRows().filter((r) => !onlyPaper || r.channel === "paper");
      if (!shown.length) {
        toast(onlyPaper ? "No paper recipients match these filters." : "No recipients match these filters.", true);
        return;
      }
      const savedPath = await exportFn(shown.map((r) => r.id));
      if (savedPath) toast(`Exported ${shown.length} row${shown.length === 1 ? "" : "s"} to ${savedPath}`);
    }
    qs("#export-csv-btn", container).addEventListener("click", () => exportShown((ids) => window.api.exportTracking(ids, "csv")));
    qs("#export-xlsx-btn", container).addEventListener("click", () => exportShown((ids) => window.api.exportTracking(ids, "xlsx")));
    qs("#export-paper-btn", container).addEventListener("click", () => exportShown((ids) => window.api.exportPaperAddresses(ids), true));

    await reload();
  },
};
