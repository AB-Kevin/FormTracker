"use strict";

function statusBadge(row) {
  if (row.status === "responded") {
    const via = row.response ? row.response.channel : "";
    const label = { web: "Web form", email_pdf: "Emailed PDF", paper: "Mailed back" }[via] || "Responded";
    return `<span class="badge badge-responded">${escapeHtml(label)}</span>`;
  }
  if (row.status === "sent") return `<span class="badge badge-sent">Sent — no reply</span>`;
  return `<span class="badge badge-pending">Pending</span>`;
}

window.Pages.tracking = {
  async render(container) {
    const mailings = await window.api.listMailings();
    const preselect = window.__trackingMailingFilter || "";
    window.__trackingMailingFilter = null;
    let statusFilter = "all";
    let mailingFilter = preselect;
    let searchTerm = "";
    let rows = [];

    container.innerHTML = `
      <h1>Tracking</h1>
      <p class="subtitle">Every recipient, how they were reached, and whether they've replied.</p>

      <div class="stat-row" id="stat-row"></div>

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
            </select>
          </div>
          <div class="field" style="flex:1">
            <label>Search</label>
            <input type="text" id="search-box" placeholder="Name or email…" />
          </div>
          <button class="btn secondary" id="sync-btn" type="button" style="align-self:flex-end;margin-bottom:12px">Sync Gravity Forms now</button>
          <button class="btn secondary" id="export-csv-btn" type="button" style="align-self:flex-end;margin-bottom:12px">Export CSV</button>
          <button class="btn secondary" id="export-xlsx-btn" type="button" style="align-self:flex-end;margin-bottom:12px">Export Excel</button>
        </div>
        <table>
          <thead><tr><th>Name</th><th>Channel</th><th>Mailing</th><th>Sent</th><th>Status</th><th></th></tr></thead>
          <tbody id="tracking-rows"></tbody>
        </table>
        <div id="tracking-empty" class="empty" style="display:none">No recipients match these filters.</div>
      </div>
    `;

    async function reload() {
      rows = await window.api.listTracking(mailingFilter || undefined);
      renderAll();
    }

    function filteredRows() {
      return rows.filter((r) => {
        if (statusFilter === "responded" && r.status !== "responded") return false;
        if (statusFilter === "not-responded" && r.status === "responded") return false;
        if (searchTerm) {
          const hay = `${r.contact?.name || ""} ${r.contact?.email || ""}`.toLowerCase();
          if (!hay.includes(searchTerm)) return false;
        }
        return true;
      });
    }

    function renderStats() {
      const total = rows.length;
      const responded = rows.filter((r) => r.status === "responded").length;
      qs("#stat-row", container).innerHTML = `
        <div class="stat-card"><div class="num">${total}</div><div class="label">Total recipients</div></div>
        <div class="stat-card"><div class="num">${responded}</div><div class="label">Responded</div></div>
        <div class="stat-card"><div class="num">${total - responded}</div><div class="label">Not yet responded</div></div>
      `;
    }

    function renderTable() {
      const list = filteredRows();
      const body = qs("#tracking-rows", container);
      qs("#tracking-empty", container).style.display = list.length ? "none" : "block";
      body.innerHTML = list
        .map(
          (r) => `
        <tr data-row="${r.id}">
          <td>${escapeHtml(r.contact?.name || "")}<br/><span class="hint">${escapeHtml(r.contact?.email || "")}</span></td>
          <td><span class="badge ${r.channel === "email" ? "badge-email" : "badge-paper"}">${r.channel}</span></td>
          <td>${escapeHtml(r.mailingName)}</td>
          <td>${formatDate(r.sentAt)}</td>
          <td>${statusBadge(r)}</td>
          <td>
            ${
              r.status !== "responded"
                ? `<button class="btn secondary" data-mark="${r.id}" type="button">Mark received…</button>`
                : r.response?.attachmentPath
                ? `<button class="btn secondary" data-open="${escapeHtml(r.response.attachmentPath)}" type="button">Open file</button>`
                : ""
            }
            ${r.generatedFilePath ? `<button class="btn secondary" data-open="${escapeHtml(r.generatedFilePath)}" type="button">Open letter</button>` : ""}
          </td>
        </tr>
        <tr class="mark-form-row" id="mark-form-${r.id}" style="display:none"><td colspan="6"></td></tr>`
        )
        .join("");

      qsa("[data-mark]", body).forEach((btn) => btn.addEventListener("click", () => openMarkForm(btn.dataset.mark)));
      qsa("[data-open]", body).forEach((btn) => btn.addEventListener("click", () => window.api.openPath(btn.dataset.open)));
    }

    function openMarkForm(recipientId) {
      const cell = qs(`#mark-form-${recipientId} td`, container);
      const row = qs(`#mark-form-${recipientId}`, container);
      row.style.display = "table-row";
      let attachmentPath = null;
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
        attachmentPath = picked;
        qs(".mark-attach-name", cell).textContent = picked.split(/[\\/]/).pop();
      });
      qs(".mark-cancel", cell).addEventListener("click", () => {
        row.style.display = "none";
      });
      qs(".mark-save", cell).addEventListener("click", async () => {
        const channel = qs(".mark-channel", cell).value;
        const notes = qs(".mark-notes", cell).value;
        await window.api.markReceived(recipientId, { channel, notes, attachmentPath });
        toast("Marked as received.");
        await reload();
      });
    }

    function renderAll() {
      renderStats();
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
        toast(`Sync complete — ${summary.matched} new response(s) matched.`);
        await reload();
      } catch (err) {
        toast(`Sync failed: ${err.message}`, true);
      }
      btn.disabled = false;
      btn.textContent = "Sync Gravity Forms now";
    });
    qs("#export-csv-btn", container).addEventListener("click", async () => {
      const savedPath = await window.api.exportTracking(mailingFilter || undefined, "csv");
      if (savedPath) toast(`Exported to ${savedPath}`);
    });
    qs("#export-xlsx-btn", container).addEventListener("click", async () => {
      const savedPath = await window.api.exportTracking(mailingFilter || undefined, "xlsx");
      if (savedPath) toast(`Exported to ${savedPath}`);
    });

    await reload();
  },
};
