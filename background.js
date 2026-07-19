// Claude Usage Badge - background service worker
//
// Reads usage data from claude.ai's own JSON API:
//   GET https://claude.ai/api/organizations/<orgId>/usage
// using the browser's existing session cookies (credentials: 'include').
// No credentials are ever hardcoded or sent anywhere else.
//
// The organization ID is NOT hardcoded. It is resolved, in order:
//   1. A manually-set override in chrome.storage.local (config.source === 'manual'),
//      set via the extension's options page.
//   2. The "lastActiveOrg" cookie on claude.ai (auto-detected).
//   3. The last successfully auto-detected org ID cached in storage.

const ALARM_NAME = "usage-poll";
const POLL_MINUTES = 3;
const DEBUG_MODE = true;

function debugLog(...args) {
  if (DEBUG_MODE) console.log("[ClaudeUsageBadge]", ...args);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: POLL_MINUTES });
  fetchUsage();
});

chrome.runtime.onStartup.addListener(() => {
  fetchUsage();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    debugLog("background poll fired");
    fetchUsage();
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "manual-refresh") {
    debugLog("manual refresh message received");
    fetchUsage().then(() => sendResponse({ ok: true }));
    return true; // async response
  }
});

async function getOrgId() {
  const stored = await chrome.storage.local.get("config");
  const config = stored.config || {};

  // 1. Manual override always wins if set.
  if (config.source === "manual" && config.orgId) {
    debugLog("org id resolved from manual override:", config.orgId);
    return config.orgId;
  }

  // 2. Try to auto-detect from the lastActiveOrg cookie.
  try {
    const cookie = await chrome.cookies.get({
      url: "https://claude.ai",
      name: "lastActiveOrg",
    });
    if (cookie && cookie.value) {
      let orgId = cookie.value;
      try {
        orgId = decodeURIComponent(orgId);
      } catch (_) {
        /* keep raw value */
      }
      orgId = orgId.replace(/^"+|"+$/g, "");
      if (orgId) {
        debugLog("org id resolved from lastActiveOrg cookie:", orgId);
        await chrome.storage.local.set({
          config: { orgId, source: "cookie" },
        });
        return orgId;
      }
    } else {
      debugLog("lastActiveOrg cookie not found");
    }
  } catch (err) {
    debugLog("cookie lookup failed:", err);
  }

  // 3. Fall back to whatever we previously cached (even if cookie lookup
  //    failed this time, e.g. transient issue).
  if (config.orgId) {
    debugLog("org id resolved from cached config:", config.orgId);
    return config.orgId;
  }

  debugLog(
    "org id not found - open the extension's options page and set it manually"
  );
  return null;
}

async function fetchUsage() {
  const orgId = await getOrgId();

  if (!orgId) {
    await saveUsage({
      error:
        "org_id_missing: could not detect organization ID. Set it manually on the extension's options page.",
      lastUpdated: Date.now(),
    });
    return;
  }

  const url = `https://claude.ai/api/organizations/${orgId}/usage`;

  try {
    const res = await fetch(url, {
      credentials: "include",
      cache: "no-store",
    });

    debugLog("fetch status:", res.status, url);

    if (!res.ok) {
      let reason = `HTTP ${res.status}`;
      if (res.status === 401) reason = "Unauthorized (401) - not logged in to claude.ai";
      else if (res.status === 403) reason = "Forbidden (403) - access denied for this organization ID";
      else if (res.status === 429) reason = "Rate limited (429) - too many requests, will retry later";
      debugLog("usage fetch failed:", reason);
      await saveUsage({ error: reason, lastUpdated: Date.now() });
      return;
    }

    const data = await res.json();
    debugLog("usage API response:", data);

    const usage = {
      session: {
        percent: data.five_hour ? data.five_hour.utilization : null,
        resetsAt: data.five_hour ? data.five_hour.resets_at : null,
      },
      weekly: {
        percent: data.seven_day ? data.seven_day.utilization : null,
        resetsAt: data.seven_day ? data.seven_day.resets_at : null,
      },
      lastUpdated: Date.now(),
      error: null,
    };

    await saveUsage(usage);
  } catch (err) {
    debugLog("fetch/parse error:", err);
    await saveUsage({
      error: String(err && err.message ? err.message : err),
      lastUpdated: Date.now(),
    });
  }
}

async function saveUsage(data) {
  await chrome.storage.local.set({ usage: data });
  debugLog("storage.local usage updated:", data);
}
