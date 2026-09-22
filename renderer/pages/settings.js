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
        <div id="update-action-area"></div>
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

    // main.js owns autoUpdater and only reports status over "update:status" --
    // this just mirrors that status into the panel. window.__updateStatus
    // (set in boot.js) carries over whatever the most recent check found, so
    // opening Settings after the automatic startup check already shows its
    // result instead of starting blank every time.
    const actionArea = qs("#update-action-area", container);

    function renderUpdateAction(status) {
      let html;
      if (status.state === "checking") {
        html = `<span class="hint">Checking for updates…</span>`;
      } else if (status.state === "available") {
        html = `<button class="btn" id="update-download-btn" type="button">Download update ${escapeHtml(status.version)}</button>`;
      } else if (status.state === "downloading") {
        html = `<span class="hint">Downloading update… ${status.percent ?? 0}%</span>`;
      } else if (status.state === "downloaded") {
        html = `<button class="btn" id="update-restart-btn" type="button">Restart to install ${escapeHtml(status.version)}</button>`;
      } else if (status.state === "not-available") {
        html = `<span class="hint">You're up to date.</span> <button class="btn secondary" id="update-check-btn" type="button">Check again</button>`;
      } else if (status.state === "error") {
        html = `<span class="hint" style="color:var(--danger)">Update check failed: ${escapeHtml(status.message || "")}</span> <button class="btn secondary" id="update-check-btn" type="button">Try again</button>`;
      } else {
        html = `<button class="btn secondary" id="update-check-btn" type="button">Check for updates</button>`;
      }
      actionArea.innerHTML = html;
      qs("#update-check-btn", actionArea)?.addEventListener("click", () => window.api.checkForUpdates());
      qs("#update-download-btn", actionArea)?.addEventListener("click", () => window.api.downloadUpdate());
      qs("#update-restart-btn", actionArea)?.addEventListener("click", () => window.api.quitAndInstall());
    }

    renderUpdateAction(window.__updateStatus || { state: "idle" });
    const unsubscribeUpdateStatus = window.api.onUpdateStatus((status) => {
      // The page's own root DOM gets replaced wholesale on every navigate()
      // (there's no per-page unmount hook in this app), so once actionArea is
      // no longer attached, this render has been left behind -- stop reacting.
      if (!document.body.contains(actionArea)) {
        unsubscribeUpdateStatus();
        return;
      }
      renderUpdateAction(status);
    });
  },
};
