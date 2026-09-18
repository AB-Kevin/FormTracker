"use strict";

window.Pages.contacts = {
  async render(container) {
    const contacts = await window.api.listContacts();

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
          <thead><tr><th>Name</th><th>Email</th><th>Address</th><th>Channel</th><th>Source</th></tr></thead>
          <tbody id="contacts-body"></tbody>
        </table>
        <div id="contacts-empty" class="empty" style="display:none">No matching contacts.</div>
      </div>
    `;

    function matches(contact, term) {
      if (!term) return true;
      const haystack = [
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

    function renderRows(term) {
      const body = qs("#contacts-body", container);
      const filtered = contacts.filter((c) => matches(c, term));
      qs("#contacts-empty", container).style.display = filtered.length ? "none" : "block";
      body.innerHTML = filtered
        .slice(0, 500)
        .map(
          (c) => `
        <tr>
          <td>${escapeHtml(c.name)}</td>
          <td>${escapeHtml(c.email)}</td>
          <td>${escapeHtml([c.addressLine1, c.city, c.state, c.zip].filter(Boolean).join(", "))}</td>
          <td><span class="badge ${c.email ? "badge-email" : "badge-paper"}">${c.email ? "Email" : "Paper"}</span></td>
          <td>${escapeHtml(c.sourceBatch || "")}</td>
        </tr>`
        )
        .join("");
    }

    renderRows("");
    qs("#search-box", container).addEventListener("input", (e) => renderRows(e.target.value.toLowerCase()));
  },
};
