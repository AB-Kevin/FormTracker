"use strict";

function looksLikeHtml(str) {
  return /<[a-z][\s\S]*>/i.test(str || "");
}

// Legacy templates (created before rich text) have a plain-text body --
// preserve their line breaks when they're first loaded into the HTML editor
// instead of collapsing them onto one line.
function plainTextToHtml(str) {
  return escapeHtml(str || "").replace(/\n/g, "<br>");
}

window.Pages.templates = {
  async render(container) {
    let templates = await window.api.listTemplates();
    let editingId = null;
    let pickedPdf = null; // { storedPath, originalName }

    container.innerHTML = `
      <h1>Templates</h1>
      <p class="subtitle">Separate templates for emailed and mailed recipients — email bodies support rich text, paper letters stay plain text. Use <code>{{externalId}}</code>, <code>{{name}}</code>, <code>{{email}}</code>, <code>{{addressLine1}}</code>, <code>{{form_link}}</code>, or <code>{{extra.ColumnName}}</code> for any other imported column.</p>

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
        <div class="field" id="body-plain-field">
          <label>Body</label>
          <textarea id="tpl-body-plain" placeholder="Dear {{name}},&#10;&#10;Please fill out your form here: {{form_link}}&#10;A fillable PDF is attached as well."></textarea>
        </div>
        <div class="field" id="body-rich-field">
          <label>Body</label>
          <div class="rte-toolbar">
            <button type="button" class="rte-btn" data-cmd="bold" title="Bold"><b>B</b></button>
            <button type="button" class="rte-btn" data-cmd="italic" title="Italic"><i>I</i></button>
            <button type="button" class="rte-btn" data-cmd="underline" title="Underline"><u>U</u></button>
            <button type="button" class="rte-btn" data-cmd="insertUnorderedList" title="Bullet list">• List</button>
            <button type="button" class="rte-btn" data-cmd="insertOrderedList" title="Numbered list">1. List</button>
            <button type="button" class="rte-btn" data-cmd="link" title="Insert link">Link</button>
            <button type="button" class="rte-btn" data-cmd="removeFormat" title="Clear formatting">Clear</button>
          </div>
          <div class="row" id="link-input-row" style="display:none;margin-bottom:6px">
            <input type="text" id="link-url-input" placeholder="https://example.org" style="flex:1" />
            <button type="button" class="btn secondary" id="link-insert-btn">Insert</button>
            <button type="button" class="btn secondary" id="link-cancel-btn">Cancel</button>
          </div>
          <div
            id="tpl-body-rich"
            class="rte-body"
            contenteditable="true"
            data-placeholder="Dear {{name}}, Please fill out your form here: {{form_link}} A fillable PDF is attached as well."
          ></div>
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
      qs("#body-rich-field", container).style.display = type === "email" ? "block" : "none";
      qs("#body-plain-field", container).style.display = type === "email" ? "none" : "flex";
    }
    qs("#tpl-type", container).addEventListener("change", toggleTypeFields);
    toggleTypeFields();

    // Electron's BrowserWindow doesn't implement window.prompt() (only
    // alert()/confirm() are supported) -- it silently does nothing -- so the
    // link URL needs its own inline input instead, following the same
    // expandable-row pattern the Tracking page uses for "Mark received".
    let savedLinkRange = null;

    qsa(".rte-btn", container).forEach((btn) => {
      btn.addEventListener("click", () => {
        qs("#tpl-body-rich", container).focus();
        if (btn.dataset.cmd === "link") {
          const sel = window.getSelection();
          savedLinkRange = sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
          qs("#link-input-row", container).style.display = "flex";
          qs("#link-url-input", container).value = "";
          qs("#link-url-input", container).focus();
        } else {
          document.execCommand(btn.dataset.cmd, false, null);
        }
      });
    });

    function insertLink() {
      const url = qs("#link-url-input", container).value.trim();
      const sel = window.getSelection();
      if (url && savedLinkRange) {
        sel.removeAllRanges();
        sel.addRange(savedLinkRange);
        document.execCommand("createLink", false, url);
      }
      qs("#link-input-row", container).style.display = "none";
      savedLinkRange = null;
    }
    qs("#link-insert-btn", container).addEventListener("click", insertLink);
    qs("#link-url-input", container).addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        insertLink();
      }
    });
    qs("#link-cancel-btn", container).addEventListener("click", () => {
      qs("#link-input-row", container).style.display = "none";
      savedLinkRange = null;
    });

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
      qs("#tpl-body-plain", container).value = "";
      qs("#tpl-body-rich", container).innerHTML = "";
      qs("#pdf-name", container).textContent = "";
      qs("#cancel-edit-btn", container).style.display = "none";
      qs("#link-input-row", container).style.display = "none";
      savedLinkRange = null;
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
          if (tpl.type === "email") {
            qs("#tpl-body-rich", container).innerHTML = looksLikeHtml(tpl.body) ? tpl.body || "" : plainTextToHtml(tpl.body);
            qs("#tpl-body-plain", container).value = "";
          } else {
            qs("#tpl-body-plain", container).value = tpl.body || "";
            qs("#tpl-body-rich", container).innerHTML = "";
          }
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
      const type = qs("#tpl-type", container).value;
      const richEl = qs("#tpl-body-rich", container);
      const body = type === "email" ? richEl.innerHTML.trim() : qs("#tpl-body-plain", container).value.trim();
      const bodyIsEmpty = type === "email" ? richEl.textContent.trim() === "" : body === "";
      if (!name || bodyIsEmpty) {
        toast("Name and body are required.", true);
        return;
      }
      const data = {
        type,
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
