const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  pickImportFile: () => ipcRenderer.invoke("dialog:pick-import-file"),
  previewImport: (filePath) => ipcRenderer.invoke("import:preview", filePath),
  commitImport: (filePath, mapping, batchName) => ipcRenderer.invoke("import:commit", filePath, mapping, batchName),

  listContacts: () => ipcRenderer.invoke("contacts:list"),
  filterableFields: () => ipcRenderer.invoke("contacts:filterable-fields"),
  previewFilter: (rules) => ipcRenderer.invoke("contacts:preview-filter", rules),

  listTemplates: () => ipcRenderer.invoke("templates:list"),
  createTemplate: (data) => ipcRenderer.invoke("templates:create", data),
  updateTemplate: (id, patch) => ipcRenderer.invoke("templates:update", id, patch),
  deleteTemplate: (id) => ipcRenderer.invoke("templates:delete", id),
  pickPdfTemplate: () => ipcRenderer.invoke("templates:pick-pdf"),

  listGravityForms: () => ipcRenderer.invoke("gf:list"),
  testGfConnection: (siteUrl, consumerKey, consumerSecret) =>
    ipcRenderer.invoke("gf:test-connection", siteUrl, consumerKey, consumerSecret),
  createGravityForm: (data) => ipcRenderer.invoke("gf:create", data),
  updateGravityForm: (id, patch) => ipcRenderer.invoke("gf:update", id, patch),
  deleteGravityForm: (id) => ipcRenderer.invoke("gf:delete", id),

  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSmtpSettings: (data) => ipcRenderer.invoke("settings:save-smtp", data),
  testSmtp: () => ipcRenderer.invoke("settings:test-smtp"),

  listMailings: () => ipcRenderer.invoke("mailings:list"),
  createMailing: (data) => ipcRenderer.invoke("mailings:create", data),
  getMailing: (id) => ipcRenderer.invoke("mailings:get", id),
  deleteMailing: (id) => ipcRenderer.invoke("mailings:delete", id),
  sendMailing: (id) => ipcRenderer.invoke("mailings:send", id),

  listTracking: (mailingId) => ipcRenderer.invoke("tracking:list", mailingId),
  pickAttachment: () => ipcRenderer.invoke("tracking:pick-attachment"),
  markReceived: (recipientId, data) => ipcRenderer.invoke("tracking:mark-received", recipientId, data),
  exportTracking: (mailingId, format) => ipcRenderer.invoke("tracking:export", mailingId, format),

  runSync: () => ipcRenderer.invoke("sync:run"),
  onSyncCompleted: (callback) => {
    const listener = (event, summary) => callback(summary);
    ipcRenderer.on("sync:completed", listener);
    return () => ipcRenderer.removeListener("sync:completed", listener);
  },

  openPath: (filePath) => ipcRenderer.invoke("shell:open-path", filePath),
  showInFolder: (filePath) => ipcRenderer.invoke("shell:show-in-folder", filePath),
  getDataDir: () => ipcRenderer.invoke("app:get-data-dir"),
  getVersion: () => ipcRenderer.invoke("app:get-version"),
});
