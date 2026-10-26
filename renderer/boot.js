"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  qsa(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => navigate(btn.dataset.page));
  });

  const version = await window.api.getVersion();
  qs("#version-tag").textContent = version;

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

  // Handlers that don't catch their own errors would otherwise fail
  // silently -- most often now, a change refused because this computer is
  // read-only.
  window.addEventListener("unhandledrejection", (e) => toast(e.reason?.message || String(e.reason), true));

  initDataBanner();

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

function reloadCurrentPage() {
  const active = qs(".nav-btn.active");
  if (active) navigate(active.dataset.page);
}

// The notices above every page about the data folder: read-only because
// someone else is editing (see lib/dataLock.js), the folder unreachable, or
// OneDrive conflict copies in it.
async function initDataBanner() {
  const banner = qs("#data-banner");
  let state = await window.api.getDataState();
  let changedSinceLoad = false;

  function line(tone, text, actions = []) {
    const el = document.createElement("div");
    el.className = `data-banner-line ${tone}`;
    const span = document.createElement("span");
    span.textContent = text;
    el.appendChild(span);
    if (actions.length) {
      const wrap = document.createElement("div");
      wrap.className = "data-banner-actions";
      for (const { label, onClick } of actions) {
        const btn = document.createElement("button");
        btn.className = "btn secondary";
        btn.type = "button";
        btn.textContent = label;
        btn.addEventListener("click", onClick);
        wrap.appendChild(btn);
      }
      el.appendChild(wrap);
    }
    banner.appendChild(el);
  }

  // Both a button here and main's "data:state" report a change, in either
  // order; whichever arrives second finds nothing new.
  function apply(next) {
    const was = state.mode;
    state = next;
    if (was === "editing" && next.mode === "read-only" && next.holder?.active) {
      toast(`${next.holder.user} on ${next.holder.machine} took over editing. FormTracker is now read-only here.`, true);
    }
    // The page may be showing data from before; whatever comes next is
    // done against what's saved now.
    if (was !== "editing" && next.mode === "editing") reloadCurrentPage();
    render();
  }

  async function startEditing() {
    const next = await window.api.startEditing();
    if (next.mode !== "editing") toast("Someone else started editing first.", true);
    apply(next);
  }

  async function takeOver() {
    const h = state.holder;
    const ok = await confirmAction(
      `Take over editing from ${h.user} on ${h.machine}? If they're still working, anything they change after this won't be saved.`,
      "Take over"
    );
    if (!ok) return;
    apply(await window.api.takeOverEditing());
  }

  function render() {
    banner.replaceChildren();
    const h = state.holder;
    if (state.mode === "unavailable") {
      line("danger", `Can't reach the data folder (${state.dataDir}), so nothing can be shown or saved. Check that OneDrive is running and the folder is synced, or choose another folder in Settings.`);
    } else if (state.mode === "read-only") {
      const reload = changedSinceLoad ? [{ label: "Show new changes", onClick: reloadCurrentPage }] : [];
      if (h?.active) {
        line("warn", `Read-only — ${h.user} on ${h.machine} is editing.${changedSinceLoad ? " They've saved changes since this page loaded." : ""}`, [
          ...reload,
          { label: "Take over editing", onClick: takeOver },
        ]);
      } else {
        const who = h ? `${h.user} on ${h.machine} hasn't been active since ${formatDate(h.heartbeatAt)}.` : "Nobody is editing now.";
        line("warn", `Read-only — ${who}`, [...reload, { label: "Start editing", onClick: startEditing }]);
      }
    }
    if (state.conflicts?.length) {
      line("danger", `OneDrive kept conflicting copies of FormTracker's data: ${state.conflicts.join(", ")}. Changes in those copies aren't in FormTracker.`, [
        { label: "Open data folder", onClick: () => window.api.openPath(state.dataDir) },
      ]);
    }
  }

  window.api.onDataState(apply);

  window.api.onDataChanged(() => {
    changedSinceLoad = true;
    render();
  });

  document.addEventListener("formtracker:navigate", () => {
    if (!changedSinceLoad) return;
    changedSinceLoad = false;
    render();
  });

  render();
}
