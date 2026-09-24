"use strict";

const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");

const store = require("./db/store");
const csvImport = require("./lib/csvImport");
const { filterContacts, listFilterableFields } = require("./lib/filter");
const { renderTemplate, buildResponseLink, htmlToPlainText } = require("./lib/merge");
const { fillPdf } = require("./lib/pdfFill");
const { generatePaperLetter } = require("./lib/paperMerge");
const mailer = require("./lib/mailer");
const gravityForms = require("./lib/gravityForms");
const { generateToken } = require("./lib/tokens");

const SYNC_INTERVAL_MS = 5 * 60 * 1000;
let mainWindow = null;

// ---- secret encryption (SMTP password, Gravity Forms consumer secret) ----
// Uses the OS keychain (DPAPI on Windows) via Electron's safeStorage, same
// idea as any other locally-stored credential; falls back to a plain base64
// encoding only if the OS facility is unavailable, so the app still works
// rather than hard-failing on an obscure environment.
function encryptSecret(plainText) {
  if (!plainText) return "";
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(plainText).toString("base64");
  }
  return "plain:" + Buffer.from(plainText, "utf8").toString("base64");
}

function decryptSecret(stored) {
  if (!stored) return "";
  if (stored.startsWith("plain:")) {
    return Buffer.from(stored.slice("plain:".length), "base64").toString("utf8");
  }
  try {
    return safeStorage.decryptString(Buffer.from(stored, "base64"));
  } catch {
    return "";
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

// Lets a dev/test run point at a throwaway data directory instead of the
// real one (%APPDATA%\formtracker by default) -- set FORMTRACKER_DATA_DIR
// before launching to avoid ever reading, seeding, or deleting a real
// installation's contacts/templates/mailings while exercising the app.
if (process.env.FORMTRACKER_DATA_DIR) {
  app.setPath("userData", process.env.FORMTRACKER_DATA_DIR);
}

app.whenReady().then(() => {
  store.init(app.getPath("userData"));
  createWindow();
  setInterval(() => {
    runSync().catch((err) => console.error("Background sync failed:", err));
  }, SYNC_INTERVAL_MS);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

ipcMain.handle("dialog:pick-import-file", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select a mailing list",
    filters: [{ name: "Spreadsheets", extensions: ["csv", "tsv", "xlsx", "xls"] }],
    properties: ["openFile"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("import:preview", async (event, filePath) => {
  const { headers, rows } = csvImport.parseFile(filePath);
  return { headers, sampleRows: rows.slice(0, 20), totalRows: rows.length };
});

ipcMain.handle("import:commit", async (event, filePath, mapping, batchName) => {
  const { rows } = csvImport.parseFile(filePath);
  const contacts = csvImport.buildContacts(rows, mapping, batchName || path.basename(filePath));
  const { inserted, updated } = store.upsertMany("contacts", "externalId", contacts);
  return { count: contacts.length, inserted, updated };
});

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

ipcMain.handle("contacts:list", async () => store.list("contacts"));

ipcMain.handle("contacts:filterable-fields", async () => listFilterableFields(store.list("contacts")));

ipcMain.handle("contacts:preview-filter", async (event, rules) => {
  const contacts = store.list("contacts");
  const matched = filterContacts(contacts, rules);
  return {
    total: matched.length,
    withEmail: matched.filter((c) => c.email).length,
    withoutEmail: matched.filter((c) => !c.email).length,
    sample: matched.slice(0, 25),
  };
});

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

ipcMain.handle("templates:list", async () => store.list("templates"));

ipcMain.handle("templates:create", async (event, data) => store.insert("templates", data));

ipcMain.handle("templates:update", async (event, id, patch) => store.update("templates", id, patch));

ipcMain.handle("templates:delete", async (event, id) => store.remove("templates", id));

ipcMain.handle("templates:pick-pdf", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select the fillable PDF template",
    filters: [{ name: "PDF", extensions: ["pdf"] }],
    properties: ["openFile"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const srcPath = result.filePaths[0];
  const destName = `${randomUUID()}.pdf`;
  const destPath = path.join(store.getDataDir(), "pdf-templates", destName);
  fs.copyFileSync(srcPath, destPath);
  return { storedPath: destPath, originalName: path.basename(srcPath) };
});

// ---------------------------------------------------------------------------
// Gravity Forms connections
// ---------------------------------------------------------------------------

ipcMain.handle("gf:list", async () =>
  store.list("gravityForms").map((gf) => ({ ...gf, consumerSecret: undefined, hasSecret: !!gf.consumerSecret }))
);

ipcMain.handle("gf:test-connection", async (event, siteUrl, consumerKey, consumerSecret) =>
  gravityForms.testConnection(siteUrl, consumerKey, consumerSecret)
);

ipcMain.handle("gf:create", async (event, data) => {
  const row = store.insert("gravityForms", { ...data, consumerSecret: encryptSecret(data.consumerSecret) });
  return { ...row, consumerSecret: undefined };
});

ipcMain.handle("gf:update", async (event, id, patch) => {
  const next = { ...patch };
  if (typeof next.consumerSecret === "string" && next.consumerSecret) {
    next.consumerSecret = encryptSecret(next.consumerSecret);
  } else {
    delete next.consumerSecret;
  }
  const row = store.update("gravityForms", id, next);
  return row && { ...row, consumerSecret: undefined };
});

ipcMain.handle("gf:delete", async (event, id) => store.remove("gravityForms", id));

// ---------------------------------------------------------------------------
// Settings (SMTP)
// ---------------------------------------------------------------------------

ipcMain.handle("settings:get", async () => {
  const settings = store.getSettings();
  return {
    smtpHost: settings.smtpHost || "",
    smtpPort: settings.smtpPort || 587,
    smtpSecure: !!settings.smtpSecure,
    smtpUser: settings.smtpUser || "",
    fromName: settings.fromName || "",
    fromEmail: settings.fromEmail || "",
    hasSmtpPassword: !!settings.smtpPassword,
    testEmail: settings.testEmail || "",
  };
});

ipcMain.handle("settings:save-smtp", async (event, data) => {
  const patch = {
    smtpHost: data.smtpHost,
    smtpPort: data.smtpPort,
    smtpSecure: !!data.smtpSecure,
    smtpUser: data.smtpUser,
    fromName: data.fromName,
    fromEmail: data.fromEmail,
    testEmail: data.testEmail,
  };
  if (data.smtpPassword) patch.smtpPassword = encryptSecret(data.smtpPassword);
  store.updateSettings(patch);
  return true;
});

function resolveSmtpConfig() {
  const s = store.getSettings();
  return {
    host: s.smtpHost,
    port: s.smtpPort,
    secure: s.smtpSecure,
    user: s.smtpUser,
    password: decryptSecret(s.smtpPassword),
    fromName: s.fromName,
    fromEmail: s.fromEmail,
  };
}

ipcMain.handle("settings:test-smtp", async () => {
  await mailer.verifyConnection(resolveSmtpConfig());
  return true;
});

// ---------------------------------------------------------------------------
// Mailings
// ---------------------------------------------------------------------------

ipcMain.handle("mailings:list", async () => store.list("mailings"));

ipcMain.handle("mailings:create", async (event, { name, templateId, paperTemplateId, gravityFormId, filterRules }) => {
  const contacts = filterContacts(store.list("contacts"), filterRules);
  const mailing = store.insert("mailings", {
    name,
    templateId,
    paperTemplateId,
    gravityFormId,
    filterRules,
    status: "draft",
  });
  const recipients = contacts.map((contact) => ({
    mailingId: mailing.id,
    contactId: contact.id,
    channel: contact.email ? "email" : "paper",
    responseToken: generateToken(),
    status: "pending",
    sentAt: null,
    generatedFilePath: null,
    error: null,
  }));
  store.insertMany("mailingRecipients", recipients);
  return mailing;
});

function hydrateRecipients(mailingId) {
  const recipients = store.list("mailingRecipients").filter((r) => r.mailingId === mailingId);
  const contacts = store.list("contacts");
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const responses = store.list("responses");
  return recipients.map((r) => {
    const responsesForRecipient = responses.filter((resp) => resp.mailingRecipientId === r.id);
    const latest = responsesForRecipient.sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt))[0];
    return {
      ...r,
      contact: contactById.get(r.contactId) || null,
      response: latest || null,
    };
  });
}

ipcMain.handle("mailings:get", async (event, id) => {
  const mailing = store.get("mailings", id);
  if (!mailing) return null;
  return { ...mailing, recipients: hydrateRecipients(id) };
});

ipcMain.handle("mailings:delete", async (event, id) => {
  const mailing = store.get("mailings", id);
  if (!mailing) return false;
  if (mailing.status === "sent") throw new Error("This mailing has already been sent and can't be deleted.");
  store.removeWhere("mailingRecipients", (r) => r.mailingId === id);
  store.remove("mailings", id);
  return true;
});

ipcMain.handle("mailings:send", async (event, mailingId) => {
  const mailing = store.get("mailings", mailingId);
  if (!mailing) throw new Error("Mailing not found.");
  const emailTemplate = mailing.templateId ? store.get("templates", mailing.templateId) : null;
  const paperTemplate = mailing.paperTemplateId ? store.get("templates", mailing.paperTemplateId) : null;
  const gravityForm = mailing.gravityFormId ? store.get("gravityForms", mailing.gravityFormId) : null;
  const smtpConfig = resolveSmtpConfig();

  const recipients = store.list("mailingRecipients").filter((r) => r.mailingId === mailingId && r.status === "pending");
  const contactById = new Map(store.list("contacts").map((c) => [c.id, c]));

  const results = { sent: 0, generated: 0, errors: [] };

  for (const recipient of recipients) {
    const contact = contactById.get(recipient.contactId);
    if (!contact) continue;
    const link = gravityForm ? buildResponseLink(gravityForm, recipient.responseToken) : "";
    const extraContext = { form_link: link };
    try {
      if (recipient.channel === "email") {
        if (!emailTemplate) throw new Error("No email template selected for this mailing.");
        const subject = renderTemplate(emailTemplate.subject, contact, extraContext);
        const bodyHtml = renderTemplate(emailTemplate.body, contact, extraContext);
        const attachments = [];
        if (emailTemplate.pdfPath) {
          const templateBytes = fs.readFileSync(emailTemplate.pdfPath);
          const filled = await fillPdf(templateBytes, contact, recipient.responseToken);
          attachments.push({ filename: `form-${recipient.responseToken}.pdf`, content: Buffer.from(filled) });
        }
        await mailer.sendMail(smtpConfig, {
          to: contact.email,
          subject,
          html: bodyHtml,
          text: htmlToPlainText(bodyHtml),
          attachments,
        });
        store.update("mailingRecipients", recipient.id, { status: "sent", sentAt: new Date().toISOString() });
        results.sent++;
      } else {
        if (!paperTemplate) throw new Error("No paper template selected for this mailing.");
        const body = renderTemplate(paperTemplate.body, contact, extraContext);
        const letterBytes = await generatePaperLetter(body, contact, recipient.responseToken);
        const destPath = path.join(store.getDataDir(), "generated-letters", `${recipient.responseToken}.pdf`);
        fs.writeFileSync(destPath, letterBytes);
        store.update("mailingRecipients", recipient.id, {
          status: "sent",
          sentAt: new Date().toISOString(),
          generatedFilePath: destPath,
        });
        results.generated++;
      }
    } catch (err) {
      store.update("mailingRecipients", recipient.id, { error: err.message });
      results.errors.push({ contactId: recipient.contactId, error: err.message });
    }
  }

  store.update("mailings", mailingId, { status: "sent" });
  return results;
});

// Sends one copy of a mailing's email template to the address configured in
// Settings, without touching any recipient or the mailing's status -- lets
// Kevin see exactly what a real send will look like before committing to it.
// Renders against a real recipient's data when the mailing has one (so merge
// fields show something realistic) but always delivers to the test address,
// never the recipient's own.
ipcMain.handle("mailings:send-test", async (event, mailingId) => {
  const mailing = store.get("mailings", mailingId);
  if (!mailing) throw new Error("Mailing not found.");
  const testEmail = store.getSettings().testEmail;
  if (!testEmail) throw new Error("Set a test email address in Settings first.");
  const emailTemplate = mailing.templateId ? store.get("templates", mailing.templateId) : null;
  if (!emailTemplate) throw new Error("This mailing has no email template selected.");
  const gravityForm = mailing.gravityFormId ? store.get("gravityForms", mailing.gravityFormId) : null;
  const smtpConfig = resolveSmtpConfig();

  const emailRecipients = store.list("mailingRecipients").filter((r) => r.mailingId === mailingId && r.channel === "email");
  const contactById = new Map(store.list("contacts").map((c) => [c.id, c]));
  const sampleRecipient = emailRecipients[0];
  const sampleContact = sampleRecipient ? contactById.get(sampleRecipient.contactId) : null;
  const contact = sampleContact || {
    externalId: "TEST-1",
    name: "Test Recipient",
    email: testEmail,
    addressLine1: "123 Sample St",
    addressLine2: "",
    city: "Sampleton",
    state: "ST",
    zip: "00000",
    extra: {},
  };
  const token = sampleRecipient ? sampleRecipient.responseToken : generateToken();
  const link = gravityForm ? buildResponseLink(gravityForm, token) : "";
  const extraContext = { form_link: link };

  const subject = `[TEST] ${renderTemplate(emailTemplate.subject, contact, extraContext)}`;
  const bodyHtml = renderTemplate(emailTemplate.body, contact, extraContext);
  const attachments = [];
  if (emailTemplate.pdfPath) {
    const templateBytes = fs.readFileSync(emailTemplate.pdfPath);
    const filled = await fillPdf(templateBytes, contact, token);
    attachments.push({ filename: `form-${token}.pdf`, content: Buffer.from(filled) });
  }

  await mailer.sendMail(smtpConfig, {
    to: testEmail,
    subject,
    html: bodyHtml,
    text: htmlToPlainText(bodyHtml),
    attachments,
  });
  return { to: testEmail };
});

// ---------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------

ipcMain.handle("tracking:list", async (event, mailingId) => {
  const recipients = mailingId
    ? store.list("mailingRecipients").filter((r) => r.mailingId === mailingId)
    : store.list("mailingRecipients");
  const contacts = new Map(store.list("contacts").map((c) => [c.id, c]));
  const mailings = new Map(store.list("mailings").map((m) => [m.id, m]));
  const responses = store.list("responses");
  return recipients.map((r) => {
    const responsesForRecipient = responses.filter((resp) => resp.mailingRecipientId === r.id);
    const latest = responsesForRecipient.sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt))[0];
    return {
      ...r,
      contact: contacts.get(r.contactId) || null,
      mailingName: mailings.get(r.mailingId)?.name || "",
      response: latest || null,
    };
  });
});

ipcMain.handle("tracking:pick-attachment", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select the returned document (scan or PDF)",
    properties: ["openFile"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("tracking:mark-received", async (event, recipientId, { channel, notes, attachmentPath, recordedBy }) => {
  const recipient = store.get("mailingRecipients", recipientId);
  if (!recipient) throw new Error("Recipient not found.");

  let storedAttachmentPath = null;
  if (attachmentPath) {
    const destName = `${randomUUID()}${path.extname(attachmentPath)}`;
    storedAttachmentPath = path.join(store.getDataDir(), "attachments", destName);
    fs.copyFileSync(attachmentPath, storedAttachmentPath);
  }

  const response = store.insert("responses", {
    mailingRecipientId: recipientId,
    channel,
    receivedAt: new Date().toISOString(),
    data: null,
    gfEntryId: null,
    attachmentPath: storedAttachmentPath,
    notes: notes || "",
    recordedBy: recordedBy || "",
  });
  store.update("mailingRecipients", recipientId, { status: "responded" });
  return response;
});

ipcMain.handle("tracking:export", async (event, mailingId, format) => {
  const recipients = mailingId
    ? store.list("mailingRecipients").filter((r) => r.mailingId === mailingId)
    : store.list("mailingRecipients");
  const contacts = new Map(store.list("contacts").map((c) => [c.id, c]));
  const responses = store.list("responses");

  const rows = recipients.map((r) => {
    const contact = contacts.get(r.contactId) || {};
    const responsesForRecipient = responses.filter((resp) => resp.mailingRecipientId === r.id);
    const latest = responsesForRecipient.sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt))[0];
    return {
      Name: contact.name || "",
      Email: contact.email || "",
      Channel: r.channel,
      Status: r.status,
      "Sent At": r.sentAt || "",
      "Responded Via": latest ? latest.channel : "",
      "Responded At": latest ? latest.receivedAt : "",
      Token: r.responseToken,
    };
  });

  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Export tracking table",
    defaultPath: `formtracker-export.${format}`,
    filters:
      format === "xlsx" ? [{ name: "Excel", extensions: ["xlsx"] }] : [{ name: "CSV", extensions: ["csv"] }],
  });
  if (result.canceled || !result.filePath) return null;

  if (format === "xlsx") {
    const XLSX = require("xlsx");
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Tracking");
    XLSX.writeFile(workbook, result.filePath);
  } else {
    const Papa = require("papaparse");
    fs.writeFileSync(result.filePath, Papa.unparse(rows), "utf8");
  }
  return result.filePath;
});

ipcMain.handle("tracking:export-paper-addresses", async (event, mailingId) => {
  const recipients = (mailingId
    ? store.list("mailingRecipients").filter((r) => r.mailingId === mailingId)
    : store.list("mailingRecipients")
  ).filter((r) => r.channel === "paper");
  const contacts = new Map(store.list("contacts").map((c) => [c.id, c]));

  const rows = recipients.map((r) => {
    const contact = contacts.get(r.contactId);
    return {
      ID: contact?.externalId || "",
      "Contact ID": r.contactId || "",
      Name: contact?.name || "",
      "Address Line 1": contact?.addressLine1 || "",
      "Address Line 2": contact?.addressLine2 || "",
      City: contact?.city || "",
      State: contact?.state || "",
      Zip: contact?.zip || "",
    };
  });

  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Export paper mailing addresses",
    defaultPath: "formtracker-paper-addresses.csv",
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (result.canceled || !result.filePath) return null;

  const Papa = require("papaparse");
  fs.writeFileSync(result.filePath, Papa.unparse(rows), "utf8");
  return result.filePath;
});

// ---------------------------------------------------------------------------
// Gravity Forms sync
// ---------------------------------------------------------------------------

async function runSync() {
  const gravityFormConfigs = store.list("gravityForms");
  const allResponses = store.list("responses");
  const allRecipients = store.list("mailingRecipients");
  const mailings = store.list("mailings");
  let totalMatched = 0;

  for (const gf of gravityFormConfigs) {
    if (!gf.formId || !gf.tokenFieldId) continue;
    const config = { ...gf, consumerSecret: decryptSecret(gf.consumerSecret) };
    const mailingIds = new Set(mailings.filter((m) => m.gravityFormId === gf.id).map((m) => m.id));
    if (mailingIds.size === 0) continue;
    const pendingRecipients = allRecipients.filter((r) => mailingIds.has(r.mailingId) && r.status !== "responded");
    if (pendingRecipients.length === 0) continue;

    const alreadySynced = allResponses.filter((r) => r.channel === "web" && r.gfEntryId).map((r) => r.gfEntryId);
    let entries;
    try {
      entries = await gravityForms.fetchEntries(config);
    } catch (err) {
      console.error(`Gravity Forms sync failed for "${gf.name}":`, err.message);
      continue;
    }
    const matches = gravityForms.matchEntriesToRecipients(entries, config, pendingRecipients, alreadySynced);
    for (const { recipient, entry, entryId } of matches) {
      store.insert("responses", {
        mailingRecipientId: recipient.id,
        channel: "web",
        receivedAt: entry.date_created || new Date().toISOString(),
        data: entry,
        gfEntryId: entryId,
        attachmentPath: null,
        notes: "",
        recordedBy: "gravity-forms-sync",
      });
      store.update("mailingRecipients", recipient.id, { status: "responded" });
      totalMatched++;
    }
  }

  if (mainWindow) mainWindow.webContents.send("sync:completed", { matched: totalMatched });
  return { matched: totalMatched };
}

ipcMain.handle("sync:run", async () => runSync());

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

ipcMain.handle("shell:open-path", async (event, filePath) => shell.openPath(filePath));
ipcMain.handle("shell:show-in-folder", async (event, filePath) => shell.showItemInFolder(filePath));
ipcMain.handle("shell:open-external", async (event, url) => {
  if (!/^https:\/\//i.test(url)) throw new Error("Only https:// links can be opened externally.");
  return shell.openExternal(url);
});
ipcMain.handle("app:get-data-dir", async () => store.getDataDir());
ipcMain.handle("app:get-version", async () => app.getVersion());

// ---------------------------------------------------------------------------
// Auto-update
// ---------------------------------------------------------------------------
// Driven entirely by the renderer's Settings page "Check for updates" button
// (and one automatic check at launch, see boot.js) -- never checks or
// downloads silently on its own beyond that, so nothing happens on the
// user's bandwidth/disk without a check having been triggered first.

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
// Lets "Check for updates" actually hit GitHub when running unpacked (npm
// start), reading dev-app-update.yml instead of silently no-op'ing. Has no
// effect on a packaged build -- those always use the real app-update.yml
// electron-builder generates, regardless of this flag.
autoUpdater.forceDevUpdateConfig = true;

function sendUpdateStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("update:status", status);
  }
}

autoUpdater.on("checking-for-update", () => sendUpdateStatus({ state: "checking" }));
autoUpdater.on("update-available", (info) => sendUpdateStatus({ state: "available", version: info.version }));
autoUpdater.on("update-not-available", () => sendUpdateStatus({ state: "not-available" }));
autoUpdater.on("download-progress", (progress) =>
  sendUpdateStatus({ state: "downloading", percent: Math.round(progress.percent) })
);
autoUpdater.on("update-downloaded", (info) => sendUpdateStatus({ state: "downloaded", version: info.version }));
autoUpdater.on("error", (err) => sendUpdateStatus({ state: "error", message: err?.message || String(err) }));

ipcMain.handle("update:check", async () => {
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    sendUpdateStatus({ state: "error", message: err?.message || String(err) });
  }
});

ipcMain.handle("update:download", async () => {
  try {
    await autoUpdater.downloadUpdate();
  } catch (err) {
    sendUpdateStatus({ state: "error", message: err?.message || String(err) });
  }
});

ipcMain.handle("update:install", () => autoUpdater.quitAndInstall());
