const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  pickImportFile: () => ipcRenderer.invoke("dialog:pick-import-file"),
  previewImport: (filePath) => ipcRenderer.invoke("import:preview", filePath),
  commitImport: (filePath, mapping, batchName) => ipcRenderer.invoke("import:commit", filePath, mapping, batchName),
  previewFieldImport: (filePath) => ipcRenderer.invoke("field-import:preview", filePath),
  checkFieldImport: (filePath, config) => ipcRenderer.invoke("field-import:check", filePath, config),
  commitFieldImport: (filePath, config) => ipcRenderer.invoke("field-import:commit", filePath, config),

  listContacts: () => ipcRenderer.invoke("contacts:list"),
  filterableFields: () => ipcRenderer.invoke("contacts:filterable-fields"),
  previewFilter: (rules) => ipcRenderer.invoke("contacts:preview-filter", rules),
  matchFilter: (rules) => ipcRenderer.invoke("contacts:match-filter", rules),
  removeContacts: (ids) => ipcRenderer.invoke("contacts:remove", ids),
  restoreContacts: (ids) => ipcRenderer.invoke("contacts:restore", ids),

  listTemplates: () => ipcRenderer.invoke("templates:list"),
  createTemplate: (data) => ipcRenderer.invoke("templates:create", data),
  updateTemplate: (id, patch) => ipcRenderer.invoke("templates:update", id, patch),
  deleteTemplate: (id) => ipcRenderer.invoke("templates:delete", id),
  pickPdfTemplate: () => ipcRenderer.invoke("templates:pick-pdf"),

  listGravityForms: () => ipcRenderer.invoke("gf:list"),
  sharedWebsite: () => ipcRenderer.invoke("gf:shared-website"),
  testGfConnection: (siteUrl, consumerKey, consumerSecret) =>
    ipcRenderer.invoke("gf:test-connection", siteUrl, consumerKey, consumerSecret),
  createGravityForm: (data) => ipcRenderer.invoke("gf:create", data),
  updateGravityForm: (id, patch) => ipcRenderer.invoke("gf:update", id, patch),
  deleteGravityForm: (id) => ipcRenderer.invoke("gf:delete", id),
  listGfReview: () => ipcRenderer.invoke("gf:review-list"),
  assignGfReview: (reviewId, recipientId) => ipcRenderer.invoke("gf:review-assign", reviewId, recipientId),
  dismissGfReview: (reviewId) => ipcRenderer.invoke("gf:review-dismiss", reviewId),

  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSmtpSettings: (data) => ipcRenderer.invoke("settings:save-smtp", data),
  testSmtp: () => ipcRenderer.invoke("settings:test-smtp"),
  setTheme: (theme) => ipcRenderer.invoke("settings:set-theme", theme),

  listMailings: () => ipcRenderer.invoke("mailings:list"),
  createMailing: (data) => ipcRenderer.invoke("mailings:create", data),
  getMailing: (id) => ipcRenderer.invoke("mailings:get", id),
  deleteMailing: (id) => ipcRenderer.invoke("mailings:delete", id),
  sendMailing: (id) => ipcRenderer.invoke("mailings:send", id),
  sendTestMailing: (id) => ipcRenderer.invoke("mailings:send-test", id),

  listTracking: (mailingId) => ipcRenderer.invoke("tracking:list", mailingId),
  pickAttachment: () => ipcRenderer.invoke("tracking:pick-attachment"),
  markReceived: (recipientId, data) => ipcRenderer.invoke("tracking:mark-received", recipientId, data),
  markMailed: (recipientIds) => ipcRenderer.invoke("tracking:mark-mailed", recipientIds),
  unmarkMailed: (recipientId) => ipcRenderer.invoke("tracking:unmark-mailed", recipientId),
  markRemailed: (recipientIds) => ipcRenderer.invoke("tracking:mark-remailed", recipientIds),
  unmarkRemailed: (recipientId) => ipcRenderer.invoke("tracking:unmark-remailed", recipientId),
  setEntered: (recipientIds, entered) => ipcRenderer.invoke("tracking:set-entered", recipientIds, entered),
  removeRecipient: (recipientId) => ipcRenderer.invoke("tracking:remove-recipient", recipientId),
  retrySend: (recipientId, email) => ipcRenderer.invoke("tracking:retry-send", recipientId, email),
  resend: (recipientIds) => ipcRenderer.invoke("tracking:resend", recipientIds),
  exportTracking: (recipientIds, format) => ipcRenderer.invoke("tracking:export", recipientIds, format),
  exportPaperAddresses: (recipientIds) => ipcRenderer.invoke("tracking:export-paper-addresses", recipientIds),

  listResponses: () => ipcRenderer.invoke("responses:list"),
  getResponse: (recipientId, responseId) => ipcRenderer.invoke("responses:get", recipientId, responseId),
  addAttachments: (responseId, filePaths) => ipcRenderer.invoke("responses:add-attachments", responseId, filePaths),
  removeAttachment: (responseId, filePath) => ipcRenderer.invoke("responses:remove-attachment", responseId, filePath),
  copyText: (text) => ipcRenderer.invoke("clipboard:write-text", text),

  runSync: () => ipcRenderer.invoke("sync:run"),
  onSyncCompleted: (callback) => {
    const listener = (event, summary) => callback(summary);
    ipcRenderer.on("sync:completed", listener);
    return () => ipcRenderer.removeListener("sync:completed", listener);
  },

  confirm: (message, okLabel) => ipcRenderer.invoke("dialog:confirm", message, okLabel),
  openPath: (filePath) => ipcRenderer.invoke("shell:open-path", filePath),
  showInFolder: (filePath) => ipcRenderer.invoke("shell:show-in-folder", filePath),
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),
  getVersion: () => ipcRenderer.invoke("app:get-version"),

  getDataState: () => ipcRenderer.invoke("data:get-state"),
  startEditing: () => ipcRenderer.invoke("data:start-editing"),
  takeOverEditing: () => ipcRenderer.invoke("data:take-over"),
  chooseDataFolder: () => ipcRenderer.invoke("data:choose-folder"),
  useDefaultDataFolder: () => ipcRenderer.invoke("data:use-default-folder"),
  onDataState: (callback) => {
    const listener = (event, state) => callback(state);
    ipcRenderer.on("data:state", listener);
    return () => ipcRenderer.removeListener("data:state", listener);
  },
  onDataChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("data:changed", listener);
    return () => ipcRenderer.removeListener("data:changed", listener);
  },

  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  quitAndInstall: () => ipcRenderer.invoke("update:install"),
  onUpdateStatus: (callback) => {
    const listener = (event, status) => callback(status);
    ipcRenderer.on("update:status", listener);
    return () => ipcRenderer.removeListener("update:status", listener);
  },
});
