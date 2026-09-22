"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  qsa(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => navigate(btn.dataset.page));
  });

  const version = await window.api.getVersion();
  qs("#version-tag").textContent = `v${version}`;

  window.api.onSyncCompleted((summary) => {
    if (summary.matched > 0) {
      toast(`Gravity Forms sync: ${summary.matched} new response${summary.matched === 1 ? "" : "s"} matched.`);
      const active = qs(".nav-btn.active");
      if (active && active.dataset.page === "tracking") navigate("tracking");
    }
  });

  // Kept in a shared spot (not just local to the Settings page) so a check
  // already run before the user opens Settings shows its result immediately
  // instead of Settings always starting from a blank "Check for updates".
  window.__updateStatus = { state: "idle" };
  window.api.onUpdateStatus((status) => {
    window.__updateStatus = status;
  });
  window.api.checkForUpdates(); // not awaited -- a startup check shouldn't hold up opening the app

  navigate("import");
});
