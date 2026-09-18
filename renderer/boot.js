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

  navigate("import");
});
