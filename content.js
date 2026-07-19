// Claude Usage Badge - content script
// Renders a small floating badge on claude.ai showing session/weekly usage.

(function () {
  const BADGE_ID = "claude-usage-badge-widget";
  const DRAG_THRESHOLD_PX = 3;
  const WARNING_THRESHOLD = 80;
  const CRITICAL_THRESHOLD = 95;
  // Minimum time the refresh icon spins for, even if the network response
  // comes back faster than that. Without this floor, a fast response can
  // trigger renderContent() (full innerHTML rebuild) before the browser
  // ever paints a frame with the "cub-spin" class applied - the class gets
  // added and effectively removed within the same tick, so no animation is
  // ever visible.
  const MIN_SPIN_MS = 700;
  let currentUsage = null;
  let badgeEl = null;
  // Tracked independently of any single DOM node: renderContent() reads
  // this flag on every rebuild and bakes the "cub-spin" class directly into
  // the freshly generated markup, so the spin survives full re-renders that
  // happen mid-request (e.g. a storage update landing while spinning).
  let refreshInFlight = false;

  // Clamps a top/left pair so the badge always stays fully within the
  // current viewport. Needed both while dragging (window can't change size
  // mid-drag, but reused here for consistency) and when restoring a saved
  // position, since a position saved on a wider/taller window would
  // otherwise place the badge off-screen - outside the clickable viewport -
  // after the window is resized narrower.
  function clampToViewport(top, left, badge) {
    const maxTop = Math.max(window.innerHeight - badge.offsetHeight, 0);
    const maxLeft = Math.max(window.innerWidth - badge.offsetWidth, 0);
    return {
      top: Math.min(Math.max(top, 0), maxTop),
      left: Math.min(Math.max(left, 0), maxLeft),
    };
  }

  function getOrCreateContainer() {
    let badge = document.getElementById(BADGE_ID);
    if (badge) {
      badgeEl = badge;
      return badge;
    }

    badge = document.createElement("div");
    badge.id = BADGE_ID;
    badge.title = "Click to refresh usage data \u00b7 Drag to move";
    badgeEl = badge;

    // These listeners are attached ONCE to the persistent outer container
    // and never touched again. All dynamic content (toggle glyph, refresh
    // icon, percentages, etc.) is rebuilt via innerHTML on every render, so
    // any listener attached directly to an inner element would be lost.
    // Event delegation on the stable container avoids that entirely.
    attachDragHandlers(badge);
    attachDelegatedClickHandlers(badge);
    restorePosition(badge);
    restoreCollapsed(badge);
    attachResizeHandler(badge);

    document.documentElement.appendChild(badge);
    return badge;
  }

  // Re-clamps the badge's position whenever the window is resized, so a
  // badge placed near the edge of a wide window doesn't end up off-screen
  // (and therefore unclickable) if the window is later made narrower.
  function attachResizeHandler(badge) {
    window.addEventListener("resize", () => {
      if (badge.style.top === "" || badge.style.left === "") return;
      const currentTop = parseFloat(badge.style.top);
      const currentLeft = parseFloat(badge.style.left);
      if (Number.isNaN(currentTop) || Number.isNaN(currentLeft)) return;

      const clamped = clampToViewport(currentTop, currentLeft, badge);
      if (clamped.top !== currentTop || clamped.left !== currentLeft) {
        console.log("[ClaudeUsageBadge] window resized, re-clamping position:", clamped);
        badge.style.top = `${clamped.top}px`;
        badge.style.left = `${clamped.left}px`;
        chrome.storage.local.set({ badgePosition: clamped });
      }
    });
  }

  function triggerManualRefresh(sourceLabel, onDone) {
    try {
      chrome.runtime.sendMessage({ type: "manual-refresh" }, () => {
        if (chrome.runtime.lastError) {
          // Most common cause: the extension was reloaded but this tab
          // still runs the old, orphaned content script (its chrome.runtime
          // port to the new background worker is dead). Reloading the page
          // re-injects a fresh content script.
          console.error(
            "[ClaudeUsageBadge] manual refresh failed:",
            chrome.runtime.lastError.message,
            "(try reloading the claude.ai tab)"
          );
        } else {
          console.log(`[ClaudeUsageBadge] refresh response received (${sourceLabel})`);
        }
        if (onDone) onDone();
      });
    } catch (err) {
      console.error(
        "[ClaudeUsageBadge] sendMessage threw - extension context invalidated, reload the page:",
        err
      );
      if (onDone) onDone();
    }
  }

  function handleBadgeClickRefresh(badge) {
    console.log("[ClaudeUsageBadge] manual refresh triggered (badge click)");
    badge.classList.add("cub-refreshing");
    triggerManualRefresh("badge-click", () => badge.classList.remove("cub-refreshing"));
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
      if (e.target.closest('[data-field="refresh-icon"]')) return;
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

      const clamped = clampToViewport(startTop + dy, startLeft + dx, badge);

      badge.style.top = `${clamped.top}px`;
      badge.style.left = `${clamped.left}px`;
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
        // Fallback: clicking anywhere on the badge (that isn't the toggle
        // or the dedicated refresh icon) still refreshes, for convenience.
        // The refresh icon below is the primary, independent way to refresh.
        handleBadgeClickRefresh(badge);
      }
    });
  }

  function attachDelegatedClickHandlers(badge) {
    badge.addEventListener("click", (e) => {
      // Fires on ANY click anywhere on the badge, before any closest()
      // matching - tests whether the click event reaches this listener at
      // all, independent of which sub-element it's supposed to match.
      console.log(
        "[ClaudeUsageBadge] badge click listener fired, target:",
        e.target,
        "clientX/clientY:",
        e.clientX,
        e.clientY
      );

      const toggleEl = e.target.closest('[data-field="toggle"]');
      if (toggleEl) {
        e.stopPropagation();
        const collapsed = badge.classList.toggle("cub-collapsed");
        chrome.storage.local.set({ badgeCollapsed: collapsed });
        console.log("[ClaudeUsageBadge] toggle clicked, collapsed:", collapsed);
        renderContent(currentUsage);
        return;
      }

      // Diagnostic: confirm e.target actually resolves to the icon (or a
      // descendant of it) and not to `badge` itself - if pointer capture
      // from a drag gesture were somehow stuck, mouse-compatibility click
      // events get retargeted to the capturing element, which would make
      // this closest() call return null even though the icon was clicked.
      console.log(
        "[ClaudeUsageBadge] click event target:",
        e.target,
        "closest refresh-icon match:",
        e.target.closest('[data-field="refresh-icon"]')
      );

      const refreshIcon = e.target.closest('[data-field="refresh-icon"]');
      if (refreshIcon) {
        // Independent of the whole-badge drag/click logic above: this is a
        // dedicated button with its own click handler, wired directly to
        // background.js via its own sendMessage call.
        e.stopPropagation();
        console.log("[ClaudeUsageBadge] manual refresh icon clicked");

        const startedAt = Date.now();
        refreshInFlight = true;
        // Apply immediately for instant feedback on the element that was
        // actually clicked (covers the common case where nothing rebuilds
        // the DOM mid-request). renderContent() also bakes this class into
        // any rebuild that happens while refreshInFlight is true, so the
        // spin isn't lost if a storage update arrives mid-spin.
        refreshIcon.classList.add("cub-spin");
        console.log(
          "[ClaudeUsageBadge] cub-spin added to icon, classList now:",
          refreshIcon.className,
          "element:",
          refreshIcon
        );

        triggerManualRefresh("refresh-icon", () => {
          const elapsed = Date.now() - startedAt;
          const remaining = Math.max(MIN_SPIN_MS - elapsed, 0);
          console.log(
            `[ClaudeUsageBadge] refresh response handled, elapsed=${elapsed}ms, will remove cub-spin in ${remaining}ms`
          );
          setTimeout(() => {
            console.log("[ClaudeUsageBadge] removing cub-spin (refreshInFlight -> false, re-rendering)");
            refreshInFlight = false;
            renderContent(currentUsage);
            console.log("[ClaudeUsageBadge] refresh spin stopped");
          }, remaining);
        });
        return;
      }
    });
  }

  function restorePosition(badge) {
    chrome.storage.local.get("badgePosition", (data) => {
      const pos = data.badgePosition;
      if (pos && typeof pos.top === "number" && typeof pos.left === "number") {
        // Clamp against the CURRENT viewport - a position saved on a wider
        // or taller window can otherwise place the badge off-screen (and
        // therefore unclickable) after the window has since been resized
        // narrower, since document.elementFromPoint() returns null for
        // coordinates outside the viewport.
        const clamped = clampToViewport(pos.top, pos.left, badge);
        console.log(
          "[ClaudeUsageBadge] restoring position, saved:",
          pos,
          "clamped to current viewport:",
          clamped
        );
        badge.style.top = `${clamped.top}px`;
        badge.style.left = `${clamped.left}px`;
        badge.style.bottom = "auto";
        badge.style.right = "auto";
        if (clamped.top !== pos.top || clamped.left !== pos.left) {
          chrome.storage.local.set({ badgePosition: clamped });
        }
      }
    });
  }

  function restoreCollapsed(badge) {
    chrome.storage.local.get("badgeCollapsed", (data) => {
      if (data.badgeCollapsed) {
        badge.classList.add("cub-collapsed");
        renderContent(currentUsage);
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

  function percentRowClass(percent) {
    if (typeof percent !== "number" || Number.isNaN(percent)) return "";
    if (percent >= CRITICAL_THRESHOLD) return "cub-pct-critical";
    if (percent >= WARNING_THRESHOLD) return "cub-pct-warning";
    return "";
  }

  function buildBodyHtml(usage) {
    const hasError = !!(usage && usage.error);

    let sessionPercentText = "—";
    let weeklyPercentText = "—";
    let sessionResetText = "";
    let weeklyResetText = "";
    let sessionRowClass = "";
    let weeklyRowClass = "";
    let updatedText = "";

    if (!hasError && usage) {
      const sessionPercent = usage.session && usage.session.percent;
      const weeklyPercent = usage.weekly && usage.weekly.percent;
      sessionPercentText = formatPercent(sessionPercent);
      weeklyPercentText = formatPercent(weeklyPercent);
      sessionResetText = formatResetsAt(usage.session && usage.session.resetsAt);
      weeklyResetText = formatResetsAt(usage.weekly && usage.weekly.resetsAt);
      sessionRowClass = percentRowClass(sessionPercent);
      weeklyRowClass = percentRowClass(weeklyPercent);
    }

    if (usage && usage.lastUpdated) {
      const d = new Date(usage.lastUpdated);
      updatedText = `updated ${d.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
    }

    console.log(
      "[ClaudeUsageBadge] buildBodyHtml: refreshInFlight =",
      refreshInFlight,
      "- refresh icon will",
      refreshInFlight ? "" : "NOT",
      "include cub-spin in generated markup"
    );

    return `
      <div class="cub-row cub-session ${sessionRowClass}" data-field="session-row">
        <span class="cub-label">Session</span>
        <span class="cub-value">${sessionPercentText}</span>
      </div>
      <div class="cub-row cub-reset">${sessionResetText}</div>
      <div class="cub-row cub-weekly ${weeklyRowClass}" data-field="weekly-row">
        <span class="cub-label">Week</span>
        <span class="cub-value">${weeklyPercentText}</span>
      </div>
      <div class="cub-row cub-reset">${weeklyResetText}</div>
      <div class="cub-row cub-updated-row">
        <span class="cub-updated-text">${updatedText}</span>
        <span class="cub-refresh-icon${refreshInFlight ? " cub-spin" : ""}" data-field="refresh-icon" title="Refresh now">\u21bb</span>
      </div>
    `;
  }

  // Full rebuild: the entire badge content (warn icon, toggle glyph, and
  // body rows) is reconstructed from scratch on every call. This guarantees
  // there are never any stale DOM references left over from a previous
  // render - every element you see is brand new.
  function renderContent(usage) {
    currentUsage = usage;
    const badge = badgeEl || getOrCreateContainer();

    console.log(
      "[ClaudeUsageBadge] renderContent() called, refreshInFlight =",
      refreshInFlight,
      "- this innerHTML rebuild will",
      refreshInFlight ? "REPLACE the currently-spinning icon element" : "not affect a spin"
    );

    const hasError = !!(usage && usage.error);
    const collapsed = badge.classList.contains("cub-collapsed");
    const toggleGlyph = collapsed ? "+" : "\u2212";
    const warnDisplay = hasError ? "inline" : "none";

    badge.classList.toggle("cub-error", hasError);
    badge.title = hasError
      ? `${usage.error} (click to retry)`
      : "Click to refresh usage data \u00b7 Drag to move";

    badge.innerHTML = `
      <span class="cub-warn" data-field="warn" style="display:${warnDisplay}">⚠</span>
      <span class="cub-toggle" data-field="toggle" title="Collapse/expand">${toggleGlyph}</span>
      <div class="cub-body" data-field="body">${buildBodyHtml(usage)}</div>
    `;

    console.log("[ClaudeUsageBadge] full re-render complete");
  }

  function init() {
    getOrCreateContainer();
    chrome.storage.local.get("usage", (data) => renderContent(data.usage));
    // Re-render every minute so "resets in Xh Ym" stays accurate without
    // triggering a new network fetch.
    setInterval(() => {
      renderContent(currentUsage);
    }, 60000);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    console.log("[ClaudeUsageBadge] storage changed:", area, changes);
    if (area === "local" && changes.usage) {
      currentUsage = changes.usage.newValue;
      if (refreshInFlight) {
        // Don't rebuild the DOM (innerHTML) while the refresh icon is
        // spinning - that would replace the spinning element with a new
        // one, restarting its CSS animation at 0deg mid-rotation. That
        // restart is what caused the visible "jitter" instead of a smooth
        // spin. The data is cached in currentUsage and picked up by the
        // single renderContent() call already scheduled to run when the
        // spin's own MIN_SPIN_MS timer ends (see the click handler).
        console.log(
          "[ClaudeUsageBadge] usage updated but refresh is in flight - deferring re-render until spin finishes"
        );
        return;
      }
      console.log("[ClaudeUsageBadge] storage updated, re-rendering");
      renderContent(currentUsage);
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
