"use strict";

// Says which of the file's columns FormTracker leaves out (lib/sensitiveColumns.js).
function leftOutNote(preview) {
  if (!preview.leftOut?.length) return "";
  return `<p class="hint">Left out, since FormTracker never keeps identity or health details: ${preview.leftOut.map(escapeHtml).join(", ")}.</p>`;
}

const CORE_FIELD_OPTIONS = [
  { value: "", label: "Keep as extra field" },
  { value: "externalId", label: "ID" },
  { value: "name", label: "Name" },
  { value: "email", label: "Email" },
  { value: "addressLine1", label: "Address Line 1" },
  { value: "addressLine2", label: "Address Line 2" },
  { value: "city", label: "City" },
  { value: "state", label: "State" },
  { value: "zip", label: "ZIP" },
];

function guessMapping(header) {
  const h = header.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["id", "memberid", "recordid", "contactid"].includes(h)) return "externalId";
  if (["name", "fullname", "contactname"].includes(h)) return "name";
  if (h.includes("email")) return "email";
  if (h === "address" || h === "address1" || h === "street") return "addressLine1";
  if (h === "address2") return "addressLine2";
  if (h === "city") return "city";
  if (h === "state" || h === "province") return "state";
  if (h === "zip" || h === "zipcode" || h === "postalcode") return "zip";
  return "";
}

window.Pages.import = {
  async render(container) {
    container.innerHTML = `
      <h1>Import Mailing List</h1>
      <div class="row" style="margin-bottom:16px">
        <button class="btn" data-mode="contacts" type="button">Contact list</button>
        <button class="btn secondary" data-mode="fields" type="button">Add fields from a linked list</button>
      </div>
      <div id="import-mode-area"></div>
    `;
    const area = qs("#import-mode-area", container);
    function showMode(mode) {
      qsa("[data-mode]", container).forEach((btn) => btn.classList.toggle("secondary", btn.dataset.mode !== mode));
      if (mode === "fields") renderFieldImport(area);
      else renderContactImport(area);
    }
    qsa("[data-mode]", container).forEach((btn) => btn.addEventListener("click", () => showMode(btn.dataset.mode)));
    showMode("contacts");
  },
};

function renderContactImport(container) {
  let filePath = null;
  let preview = null;
  let mapping = {};

  container.innerHTML = `
    <p class="subtitle">Bring in a CSV or spreadsheet file. Every column not mapped below is kept and can still be used to select recipients for a mailing.</p>
    <div class="panel">
      <div class="row">
        <button class="btn" id="pick-file-btn">Choose file…</button>
        <span id="file-name" class="hint"></span>
      </div>
    </div>
    <div id="mapping-area"></div>
  `;

  qs("#pick-file-btn", container).addEventListener("click", async () => {
    const picked = await window.api.pickImportFile();
    if (!picked) return;
    filePath = picked;
    qs("#file-name", container).textContent = filePath;
    preview = await window.api.previewImport(filePath);
    mapping = {};
    for (const header of preview.headers) mapping[header] = guessMapping(header);
    renderMapping();
  });

  function renderMapping() {
    const area = qs("#mapping-area", container);
    const defaultBatchName = filePath.split(/[\\/]/).pop();
    area.innerHTML = `
      <div class="panel">
        <h2 style="margin-top:0">Map columns (${preview.totalRows} rows found)</h2>
        <div class="field" style="max-width:320px">
          <label>Batch name</label>
          <input type="text" id="batch-name" value="${escapeHtml(defaultBatchName)}" />
        </div>
        <table>
          <thead><tr><th>Column</th><th>Maps to</th><th>Sample value</th></tr></thead>
          <tbody>
            ${preview.headers
              .map(
                (h) => `
              <tr>
                <td>${escapeHtml(h)}</td>
                <td>
                  <select data-header="${escapeHtml(h)}" class="map-select">
                    ${CORE_FIELD_OPTIONS.map(
                      (opt) =>
                        `<option value="${opt.value}" ${mapping[h] === opt.value ? "selected" : ""}>${opt.label}</option>`
                    ).join("")}
                  </select>
                </td>
                <td>${escapeHtml(preview.sampleRows[0]?.[h] ?? "")}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
        ${leftOutNote(preview)}
        <p class="hint">Rows without a value mapped to Email will be treated as paper mailings.</p>
        <p class="hint">Rows whose ID matches an existing contact update that contact in place instead of adding a duplicate.
          Fields added from a linked list are kept; new contacts get them when that list is added again.</p>
        <button class="btn" id="commit-import-btn" style="margin-top:12px">Import ${preview.totalRows} rows</button>
      </div>
    `;
    qsa(".map-select", area).forEach((sel) => {
      sel.addEventListener("change", () => {
        mapping[sel.dataset.header] = sel.value;
      });
    });
    qs("#commit-import-btn", area).addEventListener("click", async () => {
      const btn = qs("#commit-import-btn", area);
      btn.disabled = true;
      btn.textContent = "Importing…";
      try {
        const batchName = qs("#batch-name", area).value || defaultBatchName;
        const result = await window.api.commitImport(filePath, mapping, batchName);
        toast(
          (result.updated
            ? `Imported ${result.count} contacts (${result.inserted} new, ${result.updated} updated).`
            : `Imported ${result.count} contacts.`) +
            (result.stillRemoved ? ` ${result.stillRemoved} of them were removed before and stay removed.` : "")
        );
        navigate("contacts");
      } catch (err) {
        toast(`Import failed: ${err.message}`, true);
        btn.disabled = false;
        btn.textContent = `Import ${preview.totalRows} rows`;
      }
    });
  }
}

// Adds fields to contacts already imported, from a second file linked to
// them by a shared ID -- e.g. "Over 65" from a list of every member's
// birthdate. See lib/fieldImport.js.
function renderFieldImport(container) {
  let filePath = null;
  let preview = null;
  let config = null;

  container.innerHTML = `
    <p class="subtitle">Bring in a second file that lists the same people differently (e.g. every individual member, with birthdates) and add fields
      from it to the contacts you've already imported. It doesn't add or remove contacts.</p>
    <div class="panel">
      <div class="row">
        <button class="btn" id="pick-file-btn">Choose file…</button>
        <span id="file-name" class="hint"></span>
      </div>
    </div>
    <div id="link-area"></div>
  `;

  qs("#pick-file-btn", container).addEventListener("click", async () => {
    const picked = await window.api.pickImportFile();
    if (!picked) return;
    filePath = picked;
    qs("#file-name", container).textContent = filePath;
    const [filePreview, fields] = await Promise.all([window.api.previewFieldImport(filePath), window.api.filterableFields()]);
    preview = filePreview;
    config = initialConfig(fields);
    renderConfig(fields);
  });

  // The settings used last time, where this file still has those columns.
  function initialConfig(fields) {
    const saved = preview.savedConfig || {};
    const has = (h) => preview.headers.includes(h);
    const contactKeys = ["externalId", ...fields.extra.map((f) => `extra.${f}`)];
    const contactKey = contactKeys.includes(saved.contactKey) ? saved.contactKey : "externalId";
    const keyName = contactKey.replace(/^extra\./, "").toLowerCase();
    const fileKey = has(saved.fileKey)
      ? saved.fileKey
      : preview.headers.find((h) => h.toLowerCase() === keyName) || preview.headers.find((h) => /id|code/i.test(h)) || preview.headers[0];
    // A saved `age: null` means the age field was turned off last time.
    const savedAge = "age" in saved ? saved.age : {};
    return {
      contactKey,
      fileKey,
      rowRules: (saved.rowRules || []).filter((r) => has(r.field)),
      age: savedAge && {
        fieldName: savedAge.fieldName || "Over 65",
        minAge: savedAge.minAge || 65,
        birthdateColumn: has(savedAge.birthdateColumn)
          ? savedAge.birthdateColumn
          : preview.headers.find((h) => /birth|dob/i.test(h)) || "",
      },
      copyColumns: (saved.copyColumns || []).filter(has),
    };
  }

  function renderConfig(fields) {
    const sample = preview.sampleRows[0] || {};
    const columnOptions = preview.headers.map((h) => ({
      value: h,
      label: sample[h] !== undefined && sample[h] !== "" ? `${h} (e.g. ${String(sample[h]).slice(0, 30)})` : h,
    }));
    const contactKeyOptions = [{ value: "externalId", label: "ID" }, ...fields.extra.map((f) => ({ value: `extra.${f}`, label: f }))];
    const optionsHtml = (options, selectedValue) =>
      options
        .map((o) => `<option value="${escapeHtml(o.value)}" ${o.value === selectedValue ? "selected" : ""}>${escapeHtml(o.label)}</option>`)
        .join("");
    const age = config.age || { fieldName: "Over 65", minAge: 65, birthdateColumn: "" };

    qs("#link-area", container).innerHTML = `
      <div class="panel">
        <h2 style="margin-top:0">Link the lists (${preview.totalRows} rows in this file)</h2>
        <div class="row">
          <div class="field" style="flex:1">
            <label>Contact field with the shared ID</label>
            <select id="contact-key">${optionsHtml(contactKeyOptions, config.contactKey)}</select>
          </div>
          <div class="field" style="flex:1">
            <label>Column in this file with the same ID</label>
            <select id="file-key">${optionsHtml(columnOptions, config.fileKey)}</select>
          </div>
        </div>
        <h2>Use only rows where</h2>
        <div id="row-rules-area"></div>
        <button class="btn secondary" id="add-row-rule-btn" type="button">+ Add filter</button>
        <p class="hint">If the file lists several people per contact (everyone in a household), filter it down to the one row each contact should use
          — e.g. a relationship column that equals "Head".</p>
      </div>

      <div class="panel">
        <h2 style="margin-top:0">Fields to add</h2>
        <label class="entered-check" style="margin-bottom:10px">
          <input type="checkbox" id="age-on" ${config.age ? "checked" : ""} />Add an age field from a birthdate column
        </label>
        <div id="age-settings">
          <div class="row">
            <div class="field">
              <label>Field name</label>
              <input type="text" id="age-field-name" value="${escapeHtml(age.fieldName)}" />
            </div>
            <div class="field" style="flex:1">
              <label>Birthdate column</label>
              <select id="birthdate-column">
                <option value="">Choose…</option>
                ${optionsHtml(columnOptions, age.birthdateColumn)}
              </select>
            </div>
            <div class="field">
              <label>"Yes" at this age or older</label>
              <input type="number" id="min-age" min="1" value="${escapeHtml(age.minAge)}" style="width:90px" />
            </div>
          </div>
          <p class="hint">Ages are worked out as of the day you add the file, so add it again before a mailing to catch anyone with a birthday since.
            Contacts with no matching row, or whose birthdate can't be read, are left blank.</p>
        </div>
        <h2>Also copy these columns</h2>
        ${leftOutNote(preview)}
        <div class="copy-columns">
          ${preview.headers
            .map(
              (h) => `<label class="entered-check"><input type="checkbox" data-copy="${escapeHtml(h)}" ${
                config.copyColumns.includes(h) ? "checked" : ""
              } />${escapeHtml(h)}</label>`
            )
            .join("")}
        </div>
        <div class="row" style="margin-top:16px">
          <button class="btn secondary" id="check-btn" type="button">Check matches</button>
          <button class="btn" id="commit-btn" type="button">Add fields to contacts</button>
        </div>
        <div id="result-area"></div>
      </div>
    `;

    const area = qs("#link-area", container);
    const renderRowRules = () =>
      renderFilterRules(qs("#row-rules-area", area), config.rowRules, columnOptions, "No filters — every row in the file is used.");
    renderRowRules();
    qs("#add-row-rule-btn", area).addEventListener("click", () => {
      config.rowRules.push({ field: preview.headers[0] || "", op: "equals", value: "" });
      renderRowRules();
    });
    const syncAgeVisibility = () => (qs("#age-settings", area).style.display = qs("#age-on", area).checked ? "" : "none");
    syncAgeVisibility();
    qs("#age-on", area).addEventListener("change", syncAgeVisibility);

    function readConfig() {
      return {
        contactKey: qs("#contact-key", area).value,
        fileKey: qs("#file-key", area).value,
        rowRules: config.rowRules,
        age: qs("#age-on", area).checked
          ? {
              fieldName: qs("#age-field-name", area).value.trim(),
              birthdateColumn: qs("#birthdate-column", area).value,
              minAge: Number(qs("#min-age", area).value),
            }
          : null,
        copyColumns: qsa("[data-copy]", area).filter((box) => box.checked).map((box) => box.dataset.copy),
      };
    }

    qs("#check-btn", area).addEventListener("click", async () => {
      try {
        config = readConfig();
        showResult(await window.api.checkFieldImport(filePath, config), config, false);
      } catch (err) {
        toast(err.message, true);
      }
    });

    qs("#commit-btn", area).addEventListener("click", async () => {
      const btn = qs("#commit-btn", area);
      btn.disabled = true;
      try {
        config = readConfig();
        const stats = await window.api.commitFieldImport(filePath, config);
        showResult(stats, config, true);
        toast(`Updated ${stats.contacts} contacts (${stats.matched} linked to a row in the file).`);
      } catch (err) {
        toast(err.message, true);
      } finally {
        btn.disabled = false;
      }
    });
  }

  function nameList(title, items, describe) {
    if (items.length === 0) return "";
    const shown = items.slice(0, 200);
    return `
      <details class="result-list">
        <summary>${escapeHtml(title)} (${items.length})</summary>
        <ul>${shown.map((item) => `<li>${escapeHtml(describe(item))}</li>`).join("")}</ul>
        ${items.length > shown.length ? `<p class="hint">…and ${items.length - shown.length} more.</p>` : ""}
      </details>`;
  }

  function showResult(stats, usedConfig, applied) {
    const ageField = usedConfig.age?.fieldName;
    qs("#result-area", container).innerHTML = `
      <h2>${applied ? "Added" : "If you add this file now"}</h2>
      <div class="stat-row">
        <div class="stat-card"><div class="num">${stats.matched} / ${stats.contacts}</div><div class="label">Contacts linked</div></div>
        ${
          ageField
            ? `<div class="stat-card"><div class="num">${stats.ageYes}</div><div class="label">${escapeHtml(ageField)}: Yes</div></div>
               <div class="stat-card"><div class="num">${stats.ageNo}</div><div class="label">${escapeHtml(ageField)}: No</div></div>
               <div class="stat-card"><div class="num">${stats.contacts - stats.ageYes - stats.ageNo}</div><div class="label">${escapeHtml(ageField)}: blank</div></div>`
            : ""
        }
      </div>
      <p class="hint">${stats.usedRows} of the file's ${stats.fileRows} rows passed the filters${
        stats.unusedRows ? `; ${stats.unusedRows} ID${stats.unusedRows === 1 ? "" : "s"} among them matched no contact` : ""
      }.</p>
      ${nameList("Contacts with no matching row", stats.unmatched, (name) => name)}
      ${nameList("Contacts matching more than one row — the first was used; a filter can narrow it to one", stats.multiple, (m) => `${m.name} (${m.count} rows)`)}
      ${nameList("Birthdates that couldn't be read", stats.unreadableBirthdates, (b) => `${b.name}: "${b.value}"`)}
      ${
        applied && ageField
          ? `<p class="hint">On New Mailing, filter on <code>extra.${escapeHtml(ageField)}</code>: "does not equal Yes" includes the blanks, "equals No" leaves them out.</p>`
          : ""
      }
    `;
  }
}
