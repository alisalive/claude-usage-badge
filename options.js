const orgIdInput = document.getElementById("orgId");
const statusEl = document.getElementById("status");

function showStatus(text) {
  statusEl.textContent = text;
  setTimeout(() => {
    statusEl.textContent = "";
  }, 3000);
}

async function loadCurrent() {
  const { config } = await chrome.storage.local.get("config");
  if (config && config.orgId) {
    if (config.source === "manual") orgIdInput.value = config.orgId;
    statusEl.textContent = `Current org ID: ${config.orgId} (source: ${config.source})`;
  } else {
    statusEl.textContent = "No org ID resolved yet.";
  }
}

document.getElementById("save").addEventListener("click", async () => {
  const orgId = orgIdInput.value.trim();
  if (!orgId) {
    showStatus("Enter an org ID first.");
    return;
  }
  await chrome.storage.local.set({ config: { orgId, source: "manual" } });
  chrome.runtime.sendMessage({ type: "manual-refresh" });
  showStatus("Saved. Refreshing usage data...");
});

document.getElementById("clear").addEventListener("click", async () => {
  await chrome.storage.local.remove("config");
  orgIdInput.value = "";
  chrome.runtime.sendMessage({ type: "manual-refresh" });
  showStatus("Cleared. Falling back to auto-detect from cookie.");
});

loadCurrent();
