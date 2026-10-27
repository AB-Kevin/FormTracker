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
  // silently -- a send refused because this computer isn't the host, say.
  window.addEventListener("unhandledrejection", (e) => toast(e.reason?.message || String(e.reason), true));

  initSharing();

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

// Sharing the data folder (see lib/team.js): the notices above every page --
// the folder unreachable, an older FormTracker editing, this computer waiting
// to be host or the host not open, OneDrive conflict copies, and changes
// saved since the page loaded -- and, under the app's name, this computer's
// part. A page isn't redrawn under someone's typing when others' changes
// arrive; "Show new changes" does that.
async function initSharing() {
  const banner = qs("#data-banner");
  let status = await window.api.getTeamStatus();
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

  function render() {
    window.__teamStatus = status;
    banner.replaceChildren();
    const unsaved = status.unsaved ? ` (${plural(status.unsaved, "change")})` : "";
    if (status.role === "unavailable") {
      line("danger", `Can't reach the data folder (${status.dataDir}), so nothing can be shown or saved. Check that OneDrive is running and the folder is synced, or choose another folder in Settings.`);
    } else if (status.olderEditor) {
      const o = status.olderEditor;
      line("warn", `${o.user} on ${o.machine} is editing with an older FormTracker, so nothing is saved to the shared files until that copy closes or is updated. Changes made here wait on this computer${unsaved}.`);
    } else if (status.role === "waiting-host") {
      line("warn", `This computer is set as the host, but ${status.host?.name ?? "another"}'s computer already is. Only one host works at a time, so this computer's changes go through that one until its app closes. To stop being the host, turn it off in Settings.`);
    } else if (status.role === "host" && status.otherHosts.length) {
      line("warn", `${status.otherHosts.join(", ")} ${status.otherHosts.length === 1 ? "is" : "are"} also set as the host. This computer is acting as host; the others wait.`);
    } else if (status.role === "editor" && !status.host) {
      line("warn", `The host computer's app isn't open, so changes made here are kept on this computer for now${unsaved}. They're saved to the shared files when it's open again, and until then nobody else sees them.`);
    }
    if (changedSinceLoad) {
      line("info", "Changes have been saved since this page loaded.", [{ label: "Show new changes", onClick: reloadCurrentPage }]);
    }
    if (status.conflicts?.length) {
      line("danger", `OneDrive kept conflicting copies of FormTracker's data: ${status.conflicts.join(", ")}. Changes in those copies aren't in FormTracker.`, [
        { label: "Open data folder", onClick: () => window.api.openPath(status.dataDir) },
      ]);
    }

    const others = status.people.filter((p) => !p.isMe);
    let text = "";
    if (status.role === "host") text = others.length ? `Host · ${plural(others.length, "other computer")} editing` : "";
    else if (status.role === "waiting-host") text = "Host on hold";
    else if (status.role === "editor") {
      if (!status.host) text = "Editing · host not open";
      else text = status.unsaved ? `Saving ${plural(status.unsaved, "change")} through ${status.host.name}` : `Editing · ${status.host.name} is host`;
    }
    const teamLine = qs("#team-line");
    teamLine.textContent = text;
    teamLine.hidden = !text;
  }

  window.api.onTeamStatus((next) => {
    const was = status.role;
    status = next;
    // The folder came back (OneDrive started late, say): show what's in it.
    if (was === "unavailable" && next.role !== "unavailable") reloadCurrentPage();
    render();
  });

  window.api.onDataChanged(({ messages }) => {
    for (const message of messages || []) toast(message);
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
