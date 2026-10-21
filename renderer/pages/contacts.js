"use strict";

window.Pages.contacts = {
  async render(container) {
    const fields = await window.api.filterableFields();
    const allFields = [...fields.core, ...fields.extra.map((f) => `extra.${f}`)];
    let contacts = [];
    let expandedId = null;
    let showRemoved = false;
    let term = "";
    let rules = [];
    // Ids matching the applied filters, or null with none applied.
    let filterIds = null;
    const selected = new Set();

    container.innerHTML = `
      <h1>Contacts</h1>
      <p class="subtitle" id="contacts-summary"></p>
      <div class="panel">
        <div class="row" style="align-items:flex-end">
          <div class="field" style="max-width:320px;flex:1">
            <label>Search</label>
            <input type="text" id="search-box" placeholder="Name, email, address, or any column…" />
          </div>
          <div class="field">
            <label>Show</label>
            <select id="show-select">
              <option value="active">Contacts</option>
              <option value="removed">Removed contacts</option>
            </select>
          </div>
        </div>
        <div id="rules-area"></div>
        <div class="row" style="margin-bottom:12px">
          <button class="btn secondary" id="add-rule-btn" type="button">+ Add filter</button>
          <button class="btn secondary" id="apply-rules-btn" type="button">Apply filters</button>
        </div>
        <div class="row contacts-toolbar">
          <span id="selection-count" class="hint"></span>
          <button class="btn danger" id="remove-btn" type="button">Remove selected</button>
          <button class="btn secondary" id="restore-btn" type="button">Restore selected</button>
          <button class="btn secondary" id="clear-selection-btn" type="button">Clear selection</button>
        </div>
        <table>
          <thead><tr>
            <th class="check-col"><input type="checkbox" id="select-all" title="Select every contact listed" /></th>
            <th>ID</th><th>Name</th><th>Email</th><th>Address</th><th>Channel</th><th>Source</th>
          </tr></thead>
          <tbody id="contacts-body"></tbody>
        </table>
        <div id="contacts-empty" class="empty" style="display:none">No matching contacts.</div>
        <p class="hint" id="contacts-more" style="display:none"></p>
        <p class="hint">Click a contact to see every field imported for them, including columns not mapped to a core field.
          Removed contacts are left out of new mailings and stay removed when the list is imported again; mailings they're already in aren't changed.</p>
      </div>
    `;

    function matches(contact) {
      if (!!contact.removedAt !== showRemoved) return false;
      if (filterIds && !filterIds.has(contact.id)) return false;
      if (!term) return true;
      const haystack = [
        contact.externalId,
        contact.name,
        contact.email,
        contact.addressLine1,
        contact.city,
        contact.state,
        contact.zip,
        ...Object.values(contact.extra || {}),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    }

    function detailRow(label, value) {
      if (!value) return "";
      return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
    }

    function detailHtml(c) {
      const extraEntries = Object.entries(c.extra || {}).filter(([, v]) => v);
      return `
        <div class="row" style="align-items:flex-start;gap:40px;padding:12px 4px">
          <div>
            <h2 style="margin-top:0">Details</h2>
            <table class="detail-table">
              ${detailRow("ID", c.externalId)}
              ${detailRow("Name", c.name)}
              ${detailRow("Email", c.email)}
              ${detailRow("Address line 1", c.addressLine1)}
              ${detailRow("Address line 2", c.addressLine2)}
              ${detailRow("City", c.city)}
              ${detailRow("State", c.state)}
              ${detailRow("ZIP", c.zip)}
              ${detailRow("Source batch", c.sourceBatch)}
              ${detailRow("Imported", formatDate(c.createdAt))}
              ${detailRow("Removed", formatDate(c.removedAt))}
            </table>
          </div>
          <div>
            <h2 style="margin-top:0">Extra fields from import</h2>
            ${
              extraEntries.length
                ? `<table class="detail-table">${extraEntries
                    .map(([k, v]) => detailRow(k, v))
                    .join("")}</table>`
                : `<p class="hint">No additional columns were imported for this contact.</p>`
            }
          </div>
        </div>
      `;
    }

    function renderSummary() {
      const active = contacts.filter((c) => !c.removedAt);
      const removed = contacts.length - active.length;
      qs("#contacts-summary", container).textContent =
        `${active.length} contact${active.length === 1 ? "" : "s"} ` +
        `(${active.filter((c) => c.email).length} with email, ${active.filter((c) => !c.email).length} paper-only)` +
        (removed ? `, plus ${removed} removed.` : ".");
    }

    function renderToolbar(listed) {
      const count = selected.size;
      qs("#selection-count", container).textContent = count ? `${count} selected` : "Tick contacts to remove or restore them.";
      qs("#remove-btn", container).style.display = showRemoved ? "none" : "";
      qs("#restore-btn", container).style.display = showRemoved ? "" : "none";
      qs("#remove-btn", container).disabled = count === 0;
      qs("#restore-btn", container).disabled = count === 0;
      qs("#clear-selection-btn", container).disabled = count === 0;
      const selectAll = qs("#select-all", container);
      const listedSelected = listed.filter((c) => selected.has(c.id)).length;
      selectAll.checked = listed.length > 0 && listedSelected === listed.length;
      selectAll.indeterminate = listedSelected > 0 && listedSelected < listed.length;
    }

    function renderRows() {
      const body = qs("#contacts-body", container);
      const listed = contacts.filter(matches);
      qs("#contacts-empty", container).style.display = listed.length ? "none" : "block";
      const more = qs("#contacts-more", container);
      more.style.display = listed.length > 500 ? "" : "none";
      more.textContent = `Showing the first 500 of ${listed.length}. Ticking the box in the header still selects all ${listed.length}.`;
      body.innerHTML = listed
        .slice(0, 500)
        .map(
          (c) => `
        <tr class="contact-row" data-row="${c.id}">
          <td class="check-col"><input type="checkbox" data-select="${c.id}" ${selected.has(c.id) ? "checked" : ""} /></td>
          <td>${escapeHtml(c.externalId)}</td>
          <td>${escapeHtml(c.name)}</td>
          <td>${escapeHtml(c.email)}</td>
          <td>${escapeHtml([c.addressLine1, c.city, c.state, c.zip].filter(Boolean).join(", "))}</td>
          <td><span class="badge ${c.email ? "badge-email" : "badge-paper"}">${c.email ? "Email" : "Paper"}</span></td>
          <td>${escapeHtml(c.sourceBatch || "")}</td>
        </tr>
        <tr class="contact-detail-row" id="detail-${c.id}" style="display:${expandedId === c.id ? "table-row" : "none"}">
          <td colspan="7">${expandedId === c.id ? detailHtml(c) : ""}</td>
        </tr>`
        )
        .join("");

      qsa(".contact-row", body).forEach((row) => {
        row.addEventListener("click", (e) => {
          if (e.target.closest(".check-col")) return;
          expandedId = expandedId === row.dataset.row ? null : row.dataset.row;
          renderRows();
        });
      });
      qsa("[data-select]", body).forEach((box) => {
        box.addEventListener("change", () => {
          if (box.checked) selected.add(box.dataset.select);
          else selected.delete(box.dataset.select);
          renderToolbar(listed);
        });
      });
      renderToolbar(listed);
    }

    async function reload() {
      contacts = await window.api.listContacts();
      renderSummary();
      renderRows();
    }

    function renderRules() {
      renderFilterRules(qs("#rules-area", container), rules, allFields, "No filters — listing every contact that matches the search.", () => {
        if (rules.length || !filterIds) return;
        filterIds = null;
        renderRows();
      });
    }

    qs("#search-box", container).addEventListener("input", (e) => {
      term = e.target.value.toLowerCase();
      renderRows();
    });

    qs("#show-select", container).addEventListener("change", (e) => {
      showRemoved = e.target.value === "removed";
      selected.clear();
      renderRows();
    });

    qs("#add-rule-btn", container).addEventListener("click", () => {
      rules.push({ field: allFields[0] || "", op: "equals", value: "" });
      renderRules();
    });

    qs("#apply-rules-btn", container).addEventListener("click", async () => {
      filterIds = rules.length ? new Set(await window.api.matchFilter(rules)) : null;
      // Selections the filters now hide would otherwise be removed unseen.
      for (const id of selected) if (filterIds && !filterIds.has(id)) selected.delete(id);
      renderRows();
    });

    qs("#select-all", container).addEventListener("change", (e) => {
      for (const c of contacts.filter(matches)) {
        if (e.target.checked) selected.add(c.id);
        else selected.delete(c.id);
      }
      renderRows();
    });

    qs("#clear-selection-btn", container).addEventListener("click", () => {
      selected.clear();
      renderRows();
    });

    qs("#remove-btn", container).addEventListener("click", async () => {
      const count = selected.size;
      const ok = await confirmAction(
        `Remove ${count} contact${count === 1 ? "" : "s"}? They won't be included in new mailings or brought back by importing the list again. You can restore them from "Removed contacts".`,
        "Remove"
      );
      if (!ok) return;
      try {
        await window.api.removeContacts([...selected]);
        toast(`Removed ${count} contact${count === 1 ? "" : "s"}.`);
        selected.clear();
        await reload();
      } catch (err) {
        toast(`Couldn't remove: ${err.message}`, true);
      }
    });

    qs("#restore-btn", container).addEventListener("click", async () => {
      const count = selected.size;
      try {
        await window.api.restoreContacts([...selected]);
        toast(`Restored ${count} contact${count === 1 ? "" : "s"}.`);
        selected.clear();
        await reload();
      } catch (err) {
        toast(`Couldn't restore: ${err.message}`, true);
      }
    });

    renderRules();
    await reload();
  },
};
