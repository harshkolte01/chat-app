# Context: Desktop Chat App Folder + Next URL Config

## What was implemented
- Added a new folder: `desktop-chat-app/`.
- Added `desktop-chat-app/next-app-url.cjs` to define the Next app URL used by Electron.
  - Default URL: `http://127.0.0.1:3000`
  - Override supported via environment variable: `NEXT_APP_URL`
- Added `desktop-chat-app/main.cjs` to launch Electron and load the configured Next URL.
- Added `desktop-chat-app/preload.cjs` with a minimal secure bridge (`window.desktop.isDesktop`).

## Package updates
- Updated `package.json`:
  - `main` points to `desktop-chat-app/main.cjs`
  - Added scripts:
    - `desktop:start`
    - `desktop:dev`
  - Added dev dependency: `electron`
- Installed Electron and refreshed `package-lock.json`.

## Validation
- Ran `npm run lint` successfully after adding the new files.
