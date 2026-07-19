// Claude Usage Badge - content script
// Renders a small floating badge on claude.ai showing session/weekly usage.

(function () {
  const BADGE_ID = "claude-usage-badge-widget";
  const DRAG_THRESHOLD_PX = 3;
  const WARNING_THRESHOLD = 80;
  const CRITICAL_THRESHOLD = 95;
  let currentUsage = null;

  function createBadge() {
    let badge = document.getElementById(BADGE_ID);
    if (badge) return badge;

    badge = document.createElement("div");
    badge.id = BADGE_ID;
    badge.title = "Click to refresh usage data \u00b7 Drag to move";
    badge.innerHTML = `
      <span class="cub-warn" data-field="warn">⚠</span>
      <span class="cub-toggle" data-field="toggle" title="Collapse/expand">\u2212</span>
      <div class="cub-body" data-field="body">
        <div class="cub-row cub-session" data-field="session-row">
          <span class="cub-label">Session</span>
          <span class="cub-value" data-field="session-percent">…</span>
        </div>
        <div class="cub-row cub-reset" data-field="session-reset"></div>
        <div class="cub-row cub-weekly" data-field="weekly-row">
          <span class="cub-label">Week</span>
          <span class="cub-value" data-field="weekly-percent">…</span>
        </div>
        <div class="cub-row cub-reset" data-field="weekly-reset"></div>
        <div class="cub-row cub-updated" data-field="updated"></div>
      </div>
    `;

    attachDragHandlers(badge);
    attachToggleHandler(badge);
    restorePosition(badge);
    restoreCollapsed(badge);

    document.documentElement.appendChild(badge);
    return badge;
  }

  function handleRefreshClick(badge) {
    badge.classList.add("cub-refreshing");
    chrome.runtime.sendMessage({ type: "manual-refresh" }, () => {
      badge.classList.remove("cub-refreshing");
    });
  }

  function attachDragHandlers(badge) {
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let startTop = 0;
    let startLeft = 0;
    let activePointerId = null;

    // Pointer Events + setPointerCapture: once the drag starts, all
    // subsequent pointermove/pointerup events for this pointer are routed
    // directly to `badge`, regardless of what else is on the page. This
    // avoids relying on document-level listeners, which can be intercepted
    // by claude.ai's own event handling before they ever reach us.
    badge.addEventListener("pointerdown", (e) => {
      if (e.target.closest('[data-field="toggle"]')) return;
      if (e.button !== 0) return;
      dragging = true;
      moved = false;
      activePointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      const rect = badge.getBoundingClientRect();
      startTop = rect.top;
      startLeft = rect.left;
      badge.classList.add("cub-dragging");
      badge.setPointerCapture(activePointerId);
      console.log("[ClaudeUsageBadge] drag started");
      e.preventDefault();
    });

    badge.addEventListener("pointermove", (e) => {
      if (!dragging || e.pointerId !== activePointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX) {
        moved = true;
      }
      if (!moved) return;

      const maxTop = Math.max(window.innerHeight - badge.offsetHeight, 0);
      const maxLeft = Math.max(window.innerWidth - badge.offsetWidth, 0);
      const newTop = Math.min(Math.max(startTop + dy, 0), maxTop);
      const newLeft = Math.min(Math.max(startLeft + dx, 0), maxLeft);

      badge.style.top = `${newTop}px`;
      badge.style.left = `${newLeft}px`;
      badge.style.bottom = "auto";
      badge.style.right = "auto";
    });

    badge.addEventListener("pointerup", (e) => {
      if (!dragging || e.pointerId !== activePointerId) return;
      dragging = false;
      badge.classList.remove("cub-dragging");
      badge.releasePointerCapture(activePointerId);
      console.log("[ClaudeUsageBadge] drag ended, moved:", moved);

      if (moved) {
        const rect = badge.getBoundingClientRect();
        chrome.storage.local.set({
          badgePosition: { top: rect.top, left: rect.left },
        });
        console.log("[ClaudeUsageBadge] position saved:", rect.top, rect.left);
      } else {
        handleRefreshClick(badge);
      }
    });
  }

  function attachToggleHandler(badge) {
    const toggleEl = badge.querySelector('[data-field="toggle"]');
    toggleEl.addEventListener("click", (e) => {
      e.stopPropagation();
      const collapsed = badge.classList.toggle("cub-collapsed");
      toggleEl.textContent = collapsed ? "+" : "\u2212";
      chrome.storage.local.set({ badgeCollapsed: collapsed });
      console.log("[ClaudeUsageBadge] toggle clicked, collapsed:", collapsed);
    });
  }

  function restorePosition(badge) {
    chrome.storage.local.get("badgePosition", (data) => {
      const pos = data.badgePosition;
      if (pos && typeof pos.top === "number" && typeof pos.left === "number") {
        badge.style.top = `${pos.top}px`;
        badge.style.left = `${pos.left}px`;
        badge.style.bottom = "auto";
        badge.style.right = "auto";
      }
    });
  }

  function restoreCollapsed(badge) {
    chrome.storage.local.get("badgeCollapsed", (data) => {
      if (data.badgeCollapsed) {
        badge.classList.add("cub-collapsed");
        const toggleEl = badge.querySelector('[data-field="toggle"]');
        if (toggleEl) toggleEl.textContent = "+";
      }
    });
  }

  function formatPercent(p) {
    return typeof p === "number" && !Number.isNaN(p) ? `${Math.round(p)}%` : "—";
  }

  function formatResetsAt(iso) {
    if (!iso) return "";
    const resetDate = new Date(iso);
    const now = new Date();
    const diffMs = resetDate - now;
    const timeStr = resetDate.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    if (Number.isNaN(resetDate.getTime())) return "";
    if (diffMs <= 0) return `resets now (${timeStr})`;

    const totalMinutes = Math.round(diffMs / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const remaining = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    return `resets in ${remaining} (${timeStr})`;
  }

  function applyPercentClass(rowEl, percent) {
    if (!rowEl) return;
    rowEl.classList.remove("cub-pct-warning", "cub-pct-critical");
    if (typeof percent !== "number" || Number.isNaN(percent)) return;
    if (percent >= CRITICAL_THRESHOLD) rowEl.classList.add("cub-pct-critical");
    else if (percent >= WARNING_THRESHOLD) rowEl.classList.add("cub-pct-warning");
  }

  function render(usage) {
    currentUsage = usage;
    const badge = createBadge();
    if (!usage) return;

    const sessionRowEl = badge.querySelector('[data-field="session-row"]');
    const sessionPercentEl = badge.querySelector('[data-field="session-percent"]');
    const sessionResetEl = badge.querySelector('[data-field="session-reset"]');
    const weeklyRowEl = badge.querySelector('[data-field="weekly-row"]');
    const weeklyPercentEl = badge.querySelector('[data-field="weekly-percent"]');
    const weeklyResetEl = badge.querySelector('[data-field="weekly-reset"]');
    const updatedEl = badge.querySelector('[data-field="updated"]');
    const warnEl = badge.querySelector('[data-field="warn"]');

    if (usage.error) {
      badge.classList.add("cub-error");
      badge.title = `${usage.error} (click to retry)`;
      warnEl.style.display = "inline";
      sessionPercentEl.textContent = "—";
      weeklyPercentEl.textContent = "—";
      sessionResetEl.textContent = "";
      weeklyResetEl.textContent = "";
      applyPercentClass(sessionRowEl, null);
      applyPercentClass(weeklyRowEl, null);
    } else {
      badge.classList.remove("cub-error");
      badge.title = "Click to refresh usage data \u00b7 Drag to move";
      warnEl.style.display = "none";
      const sessionPercent = usage.session && usage.session.percent;
      const weeklyPercent = usage.weekly && usage.weekly.percent;
      sessionPercentEl.textContent = formatPercent(sessionPercent);
      weeklyPercentEl.textContent = formatPercent(weeklyPercent);
      sessionResetEl.textContent = formatResetsAt(usage.session && usage.session.resetsAt);
      weeklyResetEl.textContent = formatResetsAt(usage.weekly && usage.weekly.resetsAt);
      applyPercentClass(sessionRowEl, sessionPercent);
      applyPercentClass(weeklyRowEl, weeklyPercent);
    }

    if (usage.lastUpdated) {
      const d = new Date(usage.lastUpdated);
      updatedEl.textContent = `updated ${d.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
    }
  }

  function init() {
    chrome.storage.local.get("usage", (data) => render(data.usage));
    // Re-render every minute so "resets in Xh Ym" stays accurate without
    // triggering a new network fetch.
    setInterval(() => {
      if (currentUsage) render(currentUsage);
    }, 60000);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.usage) {
      render(changes.usage.newValue);
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
