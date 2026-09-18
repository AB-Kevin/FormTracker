"use strict";

const FILTER_OPS = [
  { value: "notEmpty", label: "is not empty" },
  { value: "empty", label: "is empty" },
  { value: "equals", label: "equals" },
  { value: "contains", label: "contains" },
  { value: "in", label: "is one of (comma-separated)" },
];

window.Pages["mailing-new"] = {
  async render(container) {
    const [fields, templates, gfConnections] = await Promise.all([
      window.api.filterableFields(),
      window.api.listTemplates(),
      window.api.listGravityForms(),
    ]);
    const allFields = [...fields.core.filter((f) => f !== "extra"), ...fields.extra.map((f) => `extra.${f}`)];
    let rules = [];

    container.innerHTML = `
      <h1>New Mailing</h1>
      <p class="subtitle">Select which contacts this mailing goes to. Anyone with an email address on file gets the email version; everyone else gets the paper version.</p>

      <div class="panel">
        <h2 style="margin-top:0">Who receives this mailing?</h2>
        <div id="rules-area"></div>
        <button class="btn secondary" id="add-rule-btn" type="button">+ Add filter</button>
        <div class="row" style="margin-top:14px">
          <button class="btn secondary" id="preview-btn" type="button">Preview recipients</button>
        </div>
        <div id="preview-area"></div>
      </div>

      <div class="panel">
        <h2 style="margin-top:0">Mailing details</h2>
        <div class="field" style="max-width:400px">
          <label>Mailing name</label>
          <input type="text" id="mailing-name" placeholder="e.g. 2026 Annual Survey" />
        </div>
        <div class="row">
          <div class="field" style="flex:1">
            <label>Email template</label>
            <select id="template-email">${templates
              .filter((t) => t.type === "email")
              .map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`)
              .join("") || '<option value="">No email templates yet</option>'}</select>
          </div>
          <div class="field" style="flex:1">
            <label>Paper template</label>
            <select id="template-paper">${templates
              .filter((t) => t.type === "paper")
              .map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`)
              .join("") || '<option value="">No paper templates yet</option>'}</select>
          </div>
          <div class="field" style="flex:1">
            <label>Gravity Forms form</label>
            <select id="gf-select">${gfConnections
              .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
              .join("") || '<option value="">No connections yet</option>'}</select>
          </div>
        </div>
        <button class="btn" id="create-mailing-btn" style="margin-top:8px">Create mailing</button>
      </div>
    `;

    function renderRules() {
      const area = qs("#rules-area", container);
      if (rules.length === 0) {
        area.innerHTML = '<p class="hint">No filters — this mailing will include every contact.</p>';
        return;
      }
      area.innerHTML = rules
        .map(
          (rule, i) => `
        <div class="filter-rule" data-idx="${i}">
          <select class="rule-field">${allFields
            .map((f) => `<option value="${escapeHtml(f)}" ${rule.field === f ? "selected" : ""}>${escapeHtml(f)}</option>`)
            .join("")}</select>
          <select class="rule-op">${FILTER_OPS.map(
            (o) => `<option value="${o.value}" ${rule.op === o.value ? "selected" : ""}>${o.label}</option>`
          ).join("")}</select>
          <input type="text" class="rule-value" value="${escapeHtml(rule.value || "")}" style="${
            rule.op === "empty" || rule.op === "notEmpty" ? "display:none" : ""
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
          qs(".rule-value", rowEl).style.display = e.target.value === "empty" || e.target.value === "notEmpty" ? "none" : "";
        });
        qs(".rule-value", rowEl).addEventListener("input", (e) => (rules[idx].value = e.target.value));
      });
      qsa("[data-remove]", area).forEach((btn) =>
        btn.addEventListener("click", () => {
          rules.splice(Number(btn.dataset.remove), 1);
          renderRules();
        })
      );
    }

    qs("#add-rule-btn", container).addEventListener("click", () => {
      rules.push({ field: allFields[0] || "", op: "notEmpty", value: "" });
      renderRules();
    });

    qs("#preview-btn", container).addEventListener("click", async () => {
      const result = await window.api.previewFilter(rules);
      qs("#preview-area", container).innerHTML = `
        <div class="stat-row" style="margin-top:16px">
          <div class="stat-card"><div class="num">${result.total}</div><div class="label">Total</div></div>
          <div class="stat-card"><div class="num">${result.withEmail}</div><div class="label">Email</div></div>
          <div class="stat-card"><div class="num">${result.withoutEmail}</div><div class="label">Paper</div></div>
        </div>
      `;
    });

    qs("#create-mailing-btn", container).addEventListener("click", async () => {
      const name = qs("#mailing-name", container).value.trim();
      if (!name) {
        toast("Give this mailing a name.", true);
        return;
      }
      const mailing = await window.api.createMailing({
        name,
        templateId: qs("#template-email", container).value || null,
        paperTemplateId: qs("#template-paper", container).value || null,
        gravityFormId: qs("#gf-select", container).value || null,
        filterRules: rules,
      });
      toast(`Mailing "${name}" created — recipients are ready to send.`);
      navigate("mailings");
    });

    renderRules();
  },
};
