"use strict";

// The mail server AB Apps shares, when a manager has set one there.
function sharedMailNote(mail) {
  const from = mail.fromName ? `${mail.fromName} <${mail.fromEmail}>` : mail.fromEmail;
  return `<p class="shared-note">Mail goes through the server a manager set in AB Apps: <strong>${escapeHtml(mail.host)}</strong>, port ${mail.port},
          from ${escapeHtml(from)}. A manager changes it on AB Apps' Mail and website page.</p>`;
}

window.Pages.settings = {
  async render(container) {
    const settings = await window.api.getSettings();
    const dataState = await window.api.getDataState();
    const version = await window.api.getVersion();

    container.innerHTML = `
      <h1>Settings</h1>
      <p class="subtitle">Emails are sent over SMTP, through the mail server a manager set in AB Apps or, without one, the server set here on this computer.</p>

      <div class="panel">
        <h2 style="margin-top:0">SMTP</h2>
        ${settings.sharedMail ? `${sharedMailNote(settings.sharedMail)}
        <details class="own-settings"><summary>This computer's own SMTP settings, used when AB Apps doesn't set a server</summary>` : ""}
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
            <p class="hint">Leave blank for an unauthenticated relay (e.g. one your IT team allowlists by static IP instead of a login).</p>
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
            <label>From email${settings.smtpUser ? "" : " (required — no SMTP username to fall back on)"}</label>
            <input type="email" id="from-email" value="${escapeHtml(settings.fromEmail)}" placeholder="defaults to SMTP username" />
          </div>
        </div>
        ${settings.sharedMail ? "</details>" : ""}
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
        <p class="hint">Imported contacts, templates, generated PDFs, and tracking data are stored here${dataState.isDefault ? " (this computer's own folder)" : ""}:</p>
        <div class="row">
          <code>${escapeHtml(dataState.dataDir)}</code>
          <button class="btn secondary" id="open-data-dir-btn" type="button">Open folder</button>
          <button class="btn secondary" id="change-data-dir-btn" type="button">Change folder…</button>
          ${dataState.isDefault ? "" : `<button class="btn secondary" id="default-data-dir-btn" type="button">Use this computer's folder</button>`}
        </div>
        ${dataState.available ? "" : `<p class="hint" style="color:var(--danger)">This folder can't be reached right now.</p>`}
        <p class="hint">
          To share the data with your team, copy everything in this folder except settings.json into a OneDrive or
          SharePoint folder everyone syncs, and choose that folder here — then choose it on each other computer too.
          SMTP settings, the test email address, the theme, and Gravity Forms consumer secrets aren't in this folder: each person
          enters their own here and on the Gravity Forms page, unless a manager sets the mail server and website in AB Apps.
        </p>
      </div>

      <div class="panel">
        <h2 style="margin-top:0">Sharing</h2>
        <p class="hint" style="margin-top:0">Several computers can work on the data at once from one shared folder. One of them is the host: it saves everyone's changes
          to the shared files, and it's the one that sends mailings and syncs Gravity Forms. Everyone else's changes go to it, and show up on the other computers within
          seconds of OneDrive syncing. The host's app has to be open for changes to be saved; until it is, they wait safely on the computer that made them.</p>
        <div class="row" style="align-items:flex-end">
          <div class="field" style="flex:1;max-width:320px">
            <label for="team-name">Your name</label>
            <input type="text" id="team-name" value="${escapeHtml(dataState.name || "")}" ${dataState.abApps ? "disabled" : ""} />
            <p class="hint" id="team-name-hint">Shown to others using the same folder.</p>
          </div>
          <label class="check-label" style="margin-bottom:28px"><input type="checkbox" id="team-host" ${dataState.isHost ? "checked" : ""} /> This computer is the host</label>
          <button class="btn" id="team-save-btn" type="button" style="margin-bottom:22px">Save</button>
        </div>
        <p id="team-summary"></p>
        <ul class="people-list hint" id="team-people"></ul>
        <p class="hint">If two computers are set as host, the one that has been host longer keeps the job and the other waits; when that one's app closes, the waiting one
          takes over. Changes are put in order by each computer's clock, so keep Windows' automatic time setting on.</p>
      </div>

      <div class="panel">
        <h2 style="margin-top:0">Appearance</h2>
        <div class="field">
          <label>Theme</label>
          <select id="theme-select" style="align-self:flex-start">
            <option value="system" ${settings.theme === "system" ? "selected" : ""}>Match Windows</option>
            <option value="light" ${settings.theme === "light" ? "selected" : ""}>Light</option>
            <option value="dark" ${settings.theme === "dark" ? "selected" : ""}>Dark</option>
          </select>
          <p class="hint">Applies right away. Match Windows follows Windows' own light/dark setting.</p>
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

    qs("#open-data-dir-btn", container).addEventListener("click", () => window.api.openPath(dataState.dataDir));

    qs("#change-data-dir-btn", container).addEventListener("click", async () => {
      const next = await window.api.chooseDataFolder();
      if (!next) return;
      toast(`Now using ${next.dataDir}.`);
      navigate("settings");
    });

    qs("#default-data-dir-btn", container)?.addEventListener("click", async () => {
      const ok = await confirmAction(
        "Switch back to this computer's own data folder? It has whatever was there before the shared folder was chosen — changes made in the shared folder aren't copied back.",
        "Switch"
      );
      if (!ok) return;
      const next = await window.api.useDefaultDataFolder();
      toast(`Now using ${next.dataDir}.`);
      navigate("settings");
    });

    const teamSummary = qs("#team-summary", container);
    const onPage = () => document.body.contains(teamSummary);
    function renderTeam(status) {
      if (!status || !onPage()) return;
      const summary = {
        host: "This computer is the host.",
        "waiting-host": `This computer is set as the host, but ${status.host?.name ?? "another"}'s computer already is, so this computer's changes go through that one for now.`,
        editor: status.host ? `${status.host.name}'s computer is the host; changes made here are saved through it.` : "No host computer's app is open right now; changes made here wait on this computer until one is.",
        unavailable: "The data folder can't be reached right now.",
      }[status.role];
      const unsaved = status.unsaved ? ` ${plural(status.unsaved, "change")} made here ${status.unsaved === 1 ? "is" : "are"} waiting to be saved.` : "";
      teamSummary.textContent = summary + unsaved;
      const others = status.people.filter((p) => !p.isMe);
      qs("#team-people", container).innerHTML = others.length
        ? others.map((p) => `<li>${escapeHtml(p.name)} — ${escapeHtml(p.computer || "")}${p.role === "host" ? " (host)" : ""}</li>`).join("")
        : "<li>Nobody else is using this folder right now.</li>";
      // While someone is signed in to AB Apps, others see that name, and it can't be changed here.
      const nameInput = qs("#team-name", container);
      if (status.abApps) nameInput.value = status.abApps.name;
      else if (nameInput.disabled) nameInput.value = status.name; // just signed out: the name set here again
      nameInput.disabled = !!status.abApps;
      qs("#team-name-hint", container).textContent = status.abApps
        ? "Shown to others using the same folder. It comes from AB Apps, where you're signed in; a manager changes it there."
        : "Shown to others using the same folder.";
    }
    renderTeam(dataState);
    const stopTeamStatus = window.api.onTeamStatus((status) => {
      if (!onPage()) stopTeamStatus();
      else renderTeam(status);
    });
    qs("#team-save-btn", container).addEventListener("click", async () => {
      try {
        renderTeam(await window.api.saveTeamSettings({ name: qs("#team-name", container).value, isHost: qs("#team-host", container).checked }));
        toast("Sharing settings saved.");
      } catch (err) {
        toast(err.message, true);
      }
    });

    qs("#theme-select", container).addEventListener("change", (e) =>
      window.api.setTheme(e.target.value).catch((err) => toast(`Couldn't change the theme: ${err.message}`, true))
    );

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
