# Claude Usage Badge

A small Chrome (Manifest V3) browser extension that shows your own **claude.ai**
5-hour session usage and weekly usage limit as a floating badge on the page —
no need to open Settings → Usage manually.

![screenshot placeholder](docs/screenshot.png)

## Features

- Floating badge with current session (%) and weekly (%) usage
- Countdown to the next reset for both limits, refreshed every minute
- Draggable — move the badge anywhere on screen, position is remembered
- Collapsible into a small icon when you don't need it
- Color warning: turns yellow at 80%+ and red at 95%+ usage
- Click the badge to force an immediate refresh
- Background polling every 3 minutes via `chrome.alarms`

## Installation (Load unpacked)

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome (or any Chromium-based browser).
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select this project folder.
5. Open [claude.ai](https://claude.ai) — the badge appears in the bottom-right
   corner once usage data is fetched.

## How it works

- The extension calls claude.ai's own internal JSON endpoint:
  `https://claude.ai/api/organizations/<orgId>/usage`, using your existing
  browser session cookies (`credentials: 'include'`). No credentials are ever
  hardcoded, stored remotely, or sent anywhere outside your browser.
- The organization ID is **not hardcoded**. It is auto-detected from the
  `lastActiveOrg` cookie set by claude.ai. If auto-detection fails (e.g. you
  belong to multiple orgs), open the extension's **Options** page and enter
  your org ID manually.
- Usage data is cached in `chrome.storage.local` and re-rendered locally;
  no new network request is made just to update the "resets in Xh Ym" text.

## Limitations / warnings

- This uses an **unofficial, undocumented** claude.ai API endpoint, not a
  public/stable API. Anthropic can change or remove it at any time, which
  may break this extension without notice.
- Intended for **personal use only**, to check your own account's own usage.
  It does not access or transmit any other user's data.
- No warranty — use at your own risk.

## Testing checklist

- Reload the extension after any code change (`chrome://extensions` →
  refresh icon on the extension card).
- Drag the badge by clicking and holding anywhere on it (except the `–`
  toggle) and moving the mouse; release to drop. Reload the page — the badge
  should reappear at the same position.
- Click the `–` icon to collapse the badge into a small circle; click it
  again (`+`) to expand. Reload the page — the collapsed state should persist.
- To see the warning colors, temporarily use real usage nearing 80%/95%, or
  inspect the badge in DevTools and manually add the `cub-pct-warning` /
  `cub-pct-critical` class to a `.cub-row` to preview the styling.

## License

MIT — see [LICENSE](LICENSE).
