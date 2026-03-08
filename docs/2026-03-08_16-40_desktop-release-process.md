# Desktop Release Process

## Current release version

- `package.json` version updated to `0.2.0`

## Release scripts

- `npm run version:patch`
- `npm run version:minor`
- `npm run version:major`
- `npm run release:clean`
- `npm run release:check`
- `npm run release:portable`
- `npm run release:win`
- `npm run release:dir`

## What each script does

- `release:clean` removes the existing `release` output directory.
- `release:check` runs lint, Next production build, and standalone realtime build.
- `release:portable` creates a portable Windows `.exe`.
- `release:win` creates the NSIS installer build.
- `release:dir` creates an unpacked Electron app folder for smoke testing.

## Verified output

Validated on this machine:

- `npm run release:portable`

Output:

- `release/SecretChat-0.2.0-x64.exe`
- `release/win-unpacked/SecretChat.exe`

## Release steps

1. Confirm `.env` points to your production hosts:
   - `NEXT_APP_URL=https://sec-chat-application.vercel.app`
   - `NEXT_PUBLIC_REALTIME_URL=https://chat-app-zsk7.onrender.com`
2. Bump the version:
   - patch: `npm run version:patch`
   - minor: `npm run version:minor`
   - major: `npm run version:major`
3. Build the portable `.exe`:
   - `npm run release:portable`
4. Or build the installer `.exe`:
   - `npm run release:win`
5. Find the generated artifacts inside `release/`

## Notes

- The desktop app is a hosted Electron shell. The packaged `.exe` loads the hosted Next app URL from `NEXT_APP_URL`.
- Because the binary is not code-signed with your own certificate yet, Windows SmartScreen can still warn users.
- If a packaging run fails because the previous archive is locked, rerun `npm run release:clean` and then rerun the release command.
