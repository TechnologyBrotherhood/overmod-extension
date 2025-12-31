# Contributing

Thanks for taking the time to contribute. This repo is a small Chrome extension
for overmod.org, so the workflow is intentionally lightweight.

## Quick start

- Clone the repo and open it in your editor.
- The extension source lives in `chrome/`.
- There are no build steps for local development.

## Load the extension (Chrome)

1) Go to `chrome://extensions`
2) Enable "Developer mode"
3) Click "Load unpacked" and select the `chrome/` folder

After making changes, hit the reload button on the extension card.

NOTE: If you have the extension from the store, it's useful to turn it off (don't remove it without backing up your 'private keys').

## Package a release build

Use the provided script to create a zip in `dist/`:

```sh
./bin/package.sh
```

The release process to the Chrome store is manual.

## Style and changes

- Keep edits minimal and focused.
- Prefer small, readable functions in `chrome/content.js` and `chrome/service_worker.js`.
- If you change behavior, add a short note to the PR description explaining why.

## Issues and PRs

- Please include repro steps for bugs.
- For UX changes, include a short before/after description or screenshot.

## LLM Usage

LLMs to write code in a PR are fine, but make sure you've reviewed the code yourself.
They're verbose and will repeat themselves a lot so you should try to catch that.
No PRs will be rejected for being LLM-generated, but if they're extraordinarily long or repetitive, I won't review them.
That's okay, a forked extension will still work fine with the same production backend!
