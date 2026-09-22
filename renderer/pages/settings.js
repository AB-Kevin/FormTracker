"use strict";

window.Pages.settings = {
  async render(container) {
    const settings = await window.api.getSettings();
    const dataDir = await window.api.getDataDir();
    const version = await window.api.getVersion();

    container.innerHTML = `
      <h1>Settings</h1>
      <p class="subtitle">Emails are sent through your own email account via SMTP.</p>

      <div class="panel">
        <h2 style="margin-top:0">SMTP</h2>
        <div class="row">
          <div class="field" style="flex:1">
            <label>SMTP host</label>
            <input type="text" id="smtp-host" value="${escapeHtml(settings.smtpHost)}" placeholder="smtp.gmail.com" />
          </div>
          <div class="field">
            <label>Port</label>
            <input type="number" id="smtp-port" value="${settings.smtpPort}" />
          </div>
          <div class="field">
            <label>Use TLS (465)</label>
            <select id="smtp-secure">
              <option value="false" ${!settings.smtpSecure ? "selected" : ""}>No (STARTTLS, usually 587)</option>
              <option value="true" ${settings.smtpSecure ? "selected" : ""}>Yes (465)</option>
            </select>
          </div>
        </div>
        <div class="row">
          <div class="field" style="flex:1">
            <label>SMTP username</label>
            <input type="text" id="smtp-user" value="${escapeHtml(settings.smtpUser)}" />
          </div>
          <div class="field" style="flex:1">
            <label>SMTP password ${settings.hasSmtpPassword ? "(saved — leave blank to keep)" : ""}</label>
            <input type="password" id="smtp-password" placeholder="${settings.hasSmtpPassword ? "••••••••" : "app password"}" />
          </div>
        </div>
        <div class="row">
          <div class="field" style="flex:1">
            <label>From name</label>
            <input type="text" id="from-name" value="${escapeHtml(settings.fromName)}" />
          </div>
          <div class="field" style="flex:1">
            <label>From email</label>
            <input type="email" id="from-email" value="${escapeHtml(settings.fromEmail)}" placeholder="defaults to SMTP username" />
          </div>
        </div>
        <div class="row">
          <div class="field" style="flex:1">
            <label>Test email address</label>
            <input type="email" id="test-email" value="${escapeHtml(settings.testEmail)}" placeholder="you@example.com" />
            <p class="hint">Where the "Test" button on a mailing sends its sample email.</p>
          </div>
        </div>
        <div class="row" style="margin-top:8px">
          <button class="btn" id="save-smtp-btn">Save</button>
          <button class="btn secondary" id="test-smtp-btn">Test connection</button>
        </div>
      </div>

      <div class="panel">
        <h2 style="margin-top:0">Data location</h2>
        <p class="hint">Imported contacts, templates, generated PDFs, and tracking data are stored here:</p>
        <div class="row">
          <code>${escapeHtml(dataDir)}</code>
          <button class="btn secondary" id="open-data-dir-btn" type="button">Open folder</button>
        </div>
      </div>

      <div class="panel">
        <h2 style="margin-top:0">Updates</h2>
        <p class="hint">You're running version ${escapeHtml(version)}.</p>
        <div class="row">
          <button class="btn secondary" id="check-update-btn" type="button">Check for updates</button>
          <span id="update-status" class="hint"></span>
        </div>
      </div>
    `;

    qs("#save-smtp-btn", container).addEventListener("click", async () => {
      await window.api.saveSmtpSettings({
        smtpHost: qs("#smtp-host", container).value.trim(),
        smtpPort: Number(qs("#smtp-port", container).value) || 587,
        smtpSecure: qs("#smtp-secure", container).value === "true",
        smtpUser: qs("#smtp-user", container).value.trim(),
        smtpPassword: qs("#smtp-password", container).value,
        fromName: qs("#from-name", container).value.trim(),
        fromEmail: qs("#from-email", container).value.trim(),
        testEmail: qs("#test-email", container).value.trim(),
      });
      toast("SMTP settings saved.");
    });

    qs("#test-smtp-btn", container).addEventListener("click", async () => {
      const btn = qs("#test-smtp-btn", container);
      btn.disabled = true;
      btn.textContent = "Testing…";
      try {
        await window.api.testSmtp();
        toast("SMTP connection succeeded.");
      } catch (err) {
        toast(`SMTP test failed: ${err.message}`, true);
      }
      btn.disabled = false;
      btn.textContent = "Test connection";
    });

    qs("#open-data-dir-btn", container).addEventListener("click", () => window.api.openPath(dataDir));

    qs("#check-update-btn", container).addEventListener("click", async () => {
      const btn = qs("#check-update-btn", container);
      const status = qs("#update-status", container);
      btn.disabled = true;
      btn.textContent = "Checking…";
      status.textContent = "";
      try {
        const result = await window.api.checkForUpdate();
        if (result.hasUpdate) {
          status.innerHTML = `Update available: <strong>${escapeHtml(result.latestVersion)}</strong> — `;
          const link = document.createElement("a");
          link.href = "#";
          link.textContent = "download the latest release";
          link.addEventListener("click", (e) => {
            e.preventDefault();
            window.api.openExternal(result.url);
          });
          status.appendChild(link);
        } else if (result.latestVersion) {
          status.textContent = `You're up to date (latest release is ${result.latestVersion}).`;
        } else {
          status.textContent = "No releases have been published yet.";
        }
      } catch (err) {
        status.textContent = `Couldn't check for updates: ${err.message}`;
      }
      btn.disabled = false;
      btn.textContent = "Check for updates";
    });
  },
};
