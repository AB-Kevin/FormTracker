"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  qsa(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => navigate(btn.dataset.page));
  });

  const version = await window.api.getVersion();
  qs("#version-tag").textContent = `v${version}`;

  // Background syncs only speak up when something changed, so a connection
  // that stays broken (or a review list nobody has gotten to yet) doesn't
  // toast every five minutes.
  let lastSyncErrors = "";
  let lastNeedsReview = 0;
  window.api.onSyncCompleted((summary) => {
    const errors = summary.errors.join("; ");
    if (errors && errors !== lastSyncErrors) toast(`Gravity Forms sync problem — ${errors}`, true);
    lastSyncErrors = errors;
    const moreToReview = summary.needsReview > lastNeedsReview;
    lastNeedsReview = summary.needsReview;

    if (summary.matched > 0) {
      toast(`Gravity Forms sync: ${summary.matched} new response${summary.matched === 1 ? "" : "s"} matched.`);
    }
    if (moreToReview) {
      toast(`${summary.needsReview} Gravity Forms entr${summary.needsReview === 1 ? "y needs" : "ies need"} matching by hand on the Tracking page.`);
    }
    if (summary.matched > 0 || moreToReview) {
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
