"use strict";

const REPO = "AB-Kevin/FormTracker";

// Compares two "vX.Y.Z" (or "X.Y.Z") version strings numerically, part by
// part -- plain string comparison would rank "v10.0.0" below "v9.0.0".
function isNewer(latest, current) {
  const parse = (v) =>
    String(v || "")
      .replace(/^v/i, "")
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

// GitHub's REST API requires a User-Agent header or it rejects the request.
async function checkForUpdate(currentVersion) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "FormTracker-update-check" },
  });

  if (res.status === 404) {
    // No release has been published yet -- not an error, just nothing to compare against.
    return {
      hasUpdate: false,
      currentVersion,
      latestVersion: null,
      url: `https://github.com/${REPO}/releases`,
    };
  }
  if (!res.ok) {
    throw new Error(`GitHub returned ${res.status} while checking for updates.`);
  }

  const release = await res.json();
  const latestVersion = release.tag_name || release.name || "";
  return {
    hasUpdate: isNewer(latestVersion, currentVersion),
    currentVersion,
    latestVersion,
    url: release.html_url || `https://github.com/${REPO}/releases/latest`,
  };
}

module.exports = { checkForUpdate, isNewer };
