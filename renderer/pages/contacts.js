"use strict";

window.Pages.contacts = {
  async render(container) {
    const contacts = await window.api.listContacts();
    let expandedId = null;

    container.innerHTML = `
      <h1>Contacts</h1>
      <p class="subtitle">${contacts.length} contact${contacts.length === 1 ? "" : "s"} imported
        (${contacts.filter((c) => c.email).length} with email, ${contacts.filter((c) => !c.email).length} paper-only).</p>
      <div class="panel">
        <div class="field" style="max-width:320px">
          <label>Search</label>
          <input type="text" id="search-box" placeholder="Name, email, address, or any column…" />
        </div>
        <table>
          <thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Address</th><th>Channel</th><th>Source</th></tr></thead>
          <tbody id="contacts-body"></tbody>
        </table>
        <div id="contacts-empty" class="empty" style="display:none">No matching contacts.</div>
        <p class="hint">Click a contact to see every field imported for them, including columns not mapped to a core field.</p>
      </div>
    `;

    function matches(contact, term) {
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

    function renderRows(term) {
      const body = qs("#contacts-body", container);
      const filtered = contacts.filter((c) => matches(c, term));
      qs("#contacts-empty", container).style.display = filtered.length ? "none" : "block";
      body.innerHTML = filtered
        .slice(0, 500)
        .map(
          (c) => `
        <tr class="contact-row" data-row="${c.id}">
          <td>${escapeHtml(c.externalId)}</td>
          <td>${escapeHtml(c.name)}</td>
          <td>${escapeHtml(c.email)}</td>
          <td>${escapeHtml([c.addressLine1, c.city, c.state, c.zip].filter(Boolean).join(", "))}</td>
          <td><span class="badge ${c.email ? "badge-email" : "badge-paper"}">${c.email ? "Email" : "Paper"}</span></td>
          <td>${escapeHtml(c.sourceBatch || "")}</td>
        </tr>
        <tr class="contact-detail-row" id="detail-${c.id}" style="display:${expandedId === c.id ? "table-row" : "none"}">
          <td colspan="6">${expandedId === c.id ? detailHtml(c) : ""}</td>
        </tr>`
        )
        .join("");

      qsa(".contact-row", body).forEach((row) => {
        row.addEventListener("click", () => {
          expandedId = expandedId === row.dataset.row ? null : row.dataset.row;
          renderRows(term);
        });
      });
    }

    renderRows("");
    qs("#search-box", container).addEventListener("input", (e) => renderRows(e.target.value.toLowerCase()));
  },
};
