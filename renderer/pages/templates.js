"use strict";

window.Pages.templates = {
  async render(container) {
    let templates = await window.api.listTemplates();
    let editingId = null;
    let pickedPdf = null; // { storedPath, originalName }

    container.innerHTML = `
      <h1>Templates</h1>
      <p class="subtitle">Separate templates for emailed and mailed recipients. Use <code>{{externalId}}</code>, <code>{{name}}</code>, <code>{{email}}</code>, <code>{{addressLine1}}</code>, <code>{{form_link}}</code>, or <code>{{extra.ColumnName}}</code> for any other imported column.</p>

      <div class="panel">
        <h2 style="margin-top:0" id="form-title">New template</h2>
        <div class="row">
          <div class="field">
            <label>Type</label>
            <select id="tpl-type">
              <option value="email">Email</option>
              <option value="paper">Paper letter</option>
            </select>
          </div>
          <div class="field" style="flex:1">
            <label>Name</label>
            <input type="text" id="tpl-name" placeholder="e.g. Annual Survey — Email" />
          </div>
        </div>
        <div class="field" id="subject-field">
          <label>Subject</label>
          <input type="text" id="tpl-subject" placeholder="e.g. Please complete your {{extra.Committee}} form" />
        </div>
        <div class="field">
          <label>Body</label>
          <textarea id="tpl-body" placeholder="Dear {{name}},&#10;&#10;Please fill out your form here: {{form_link}}&#10;A fillable PDF is attached as well."></textarea>
        </div>
        <div class="field" id="pdf-field">
          <label>Fillable PDF attachment</label>
          <div class="row">
            <button class="btn secondary" id="pick-pdf-btn" type="button">Choose PDF…</button>
            <span class="hint" id="pdf-name"></span>
          </div>
        </div>
        <div class="row" style="margin-top:12px">
          <button class="btn" id="save-tpl-btn">Save template</button>
          <button class="btn secondary" id="cancel-edit-btn" style="display:none">Cancel edit</button>
        </div>
      </div>

      <h2>Existing templates</h2>
      <div class="panel">
        <table>
          <thead><tr><th>Name</th><th>Type</th><th>PDF attached</th><th></th></tr></thead>
          <tbody id="tpl-body-rows"></tbody>
        </table>
        <div id="tpl-empty" class="empty" style="display:none">No templates yet.</div>
      </div>
    `;

    function toggleTypeFields() {
      const type = qs("#tpl-type", container).value;
      qs("#subject-field", container).style.display = type === "email" ? "flex" : "none";
      qs("#pdf-field", container).style.display = type === "email" ? "flex" : "none";
    }
    qs("#tpl-type", container).addEventListener("change", toggleTypeFields);
    toggleTypeFields();

    qs("#pick-pdf-btn", container).addEventListener("click", async () => {
      const result = await window.api.pickPdfTemplate();
      if (!result) return;
      pickedPdf = result;
      qs("#pdf-name", container).textContent = result.originalName;
    });

    function resetForm() {
      editingId = null;
      pickedPdf = null;
      qs("#form-title", container).textContent = "New template";
      qs("#tpl-type", container).value = "email";
      qs("#tpl-name", container).value = "";
      qs("#tpl-subject", container).value = "";
      qs("#tpl-body", container).value = "";
      qs("#pdf-name", container).textContent = "";
      qs("#cancel-edit-btn", container).style.display = "none";
      toggleTypeFields();
    }

    qs("#cancel-edit-btn", container).addEventListener("click", resetForm);

    function renderList() {
      const body = qs("#tpl-body-rows", container);
      qs("#tpl-empty", container).style.display = templates.length ? "none" : "block";
      body.innerHTML = templates
        .map(
          (t) => `
        <tr>
          <td>${escapeHtml(t.name)}</td>
          <td><span class="badge ${t.type === "email" ? "badge-email" : "badge-paper"}">${t.type}</span></td>
          <td>${t.pdfPath ? "Yes" : "—"}</td>
          <td>
            <button class="btn secondary" data-edit="${t.id}">Edit</button>
            <button class="btn danger" data-delete="${t.id}">Delete</button>
          </td>
        </tr>`
        )
        .join("");

      qsa("[data-edit]", body).forEach((btn) =>
        btn.addEventListener("click", () => {
          const tpl = templates.find((t) => t.id === btn.dataset.edit);
          editingId = tpl.id;
          pickedPdf = tpl.pdfPath ? { storedPath: tpl.pdfPath, originalName: tpl.pdfOriginalName || "current file" } : null;
          qs("#form-title", container).textContent = `Editing: ${tpl.name}`;
          qs("#tpl-type", container).value = tpl.type;
          qs("#tpl-name", container).value = tpl.name;
          qs("#tpl-subject", container).value = tpl.subject || "";
          qs("#tpl-body", container).value = tpl.body || "";
          qs("#pdf-name", container).textContent = pickedPdf ? pickedPdf.originalName : "";
          qs("#cancel-edit-btn", container).style.display = "inline-block";
          toggleTypeFields();
          window.scrollTo(0, 0);
        })
      );
      qsa("[data-delete]", body).forEach((btn) =>
        btn.addEventListener("click", async () => {
          if (!confirm("Delete this template?")) return;
          await window.api.deleteTemplate(btn.dataset.delete);
          templates = await window.api.listTemplates();
          renderList();
          toast("Template deleted.");
        })
      );
    }

    qs("#save-tpl-btn", container).addEventListener("click", async () => {
      const name = qs("#tpl-name", container).value.trim();
      const body = qs("#tpl-body", container).value.trim();
      if (!name || !body) {
        toast("Name and body are required.", true);
        return;
      }
      const data = {
        type: qs("#tpl-type", container).value,
        name,
        subject: qs("#tpl-subject", container).value.trim(),
        body,
        pdfPath: pickedPdf ? pickedPdf.storedPath : null,
        pdfOriginalName: pickedPdf ? pickedPdf.originalName : null,
      };
      if (editingId) {
        await window.api.updateTemplate(editingId, data);
        toast("Template updated.");
      } else {
        await window.api.createTemplate(data);
        toast("Template created.");
      }
      templates = await window.api.listTemplates();
      resetForm();
      renderList();
    });

    renderList();
  },
};
