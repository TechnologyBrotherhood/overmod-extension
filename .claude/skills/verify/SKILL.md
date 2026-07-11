---
name: verify
description: Drive the Overmod extension in a real Chrome against live HN to verify content-script changes.
---

# Verifying the Overmod extension

The surface is the content script running on news.ycombinator.com. Drive it
with puppeteer-core + **Chrome for Testing** (branded Chrome ≥137 dropped
`--load-extension`; the system Chrome will NOT load the extension and fails
silently — no extension targets appear).

## Recipe

1. In a scratch dir: `npm i puppeteer-core` and
   `npx @puppeteer/browsers install chrome@stable` (gives
   `chrome/mac_*/…/Google Chrome for Testing`).
2. Launch with `headless: false`, a temp `userDataDir`, and args
   `--disable-extensions-except=<repo>/chrome --load-extension=<repo>/chrome`.
3. Navigate to a busy HN thread first (pick one via
   `curl -s https://news.ycombinator.com/news | grep -oE 'item\?id=[0-9]+">[0-9]+&nbsp;comments'`),
   THEN `browser.waitForTarget(t => t.type() === 'service_worker')` — the MV3
   worker is lazy and only spins up when the content script messages it.
4. Seed state by evaluating in the service worker:
   `chrome.storage.local.set({ overmod: {...} })`. The content script reacts
   to storage changes live (no reload needed).
   - To exercise the live-update path, write derived state directly:
     `overmod.blocked = { combined: [...], combinedWithoutTransient: [...], transientOnly: [], sourceLists: {}, localPatterns: [...], lastSync: null }`.
   - To exercise the initial-load path (reload), seed the SOURCE field
     `overmod.localBlockedUsers` instead — on page load the worker's
     opportunistic sync recomputes `blocked.*` and will clobber any
     hand-written derived state.
5. Observe from the page: rows are `tr.athing.comtr`; hidden ones carry class
   `overmod-hidden` (display:none); header is `#overmod-header` (text like
   `| 1 blocked | 0 hidden | 0 green shown`); banner is
   `#overmod-removed-banner`.

## Gotchas

- Content scripts run in an isolated world: `page.evaluate` cannot call
  extension functions like `buildIndex`. Observe DOM effects (classes,
  computed style, MutationObserver) instead.
- Unit tests: `bin/test.sh` runs all `chrome/*.test.js` under plain node;
  testable modules end with a `module.exports` guard.

A working harness from a past session (seed/probe/timing steps) can be
recreated from this recipe in ~5 minutes; flows worth driving: exact-name
block, regex pattern block, invalid pattern, hideGreenComments toggle,
clear-all, reload persistence.
