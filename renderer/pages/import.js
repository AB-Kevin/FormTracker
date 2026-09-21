"use strict";

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
    let filePath = null;
    let preview = null;
    let mapping = {};

    container.innerHTML = `
      <h1>Import Mailing List</h1>
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
          <p class="hint">Rows without a value mapped to Email will be treated as paper mailings.</p>
          <p class="hint">Rows whose ID matches an existing contact update that contact in place instead of adding a duplicate.</p>
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
            result.updated
              ? `Imported ${result.count} contacts (${result.inserted} new, ${result.updated} updated).`
              : `Imported ${result.count} contacts.`
          );
          navigate("contacts");
        } catch (err) {
          toast(`Import failed: ${err.message}`, true);
          btn.disabled = false;
          btn.textContent = `Import ${preview.totalRows} rows`;
        }
      });
    }
  },
};
