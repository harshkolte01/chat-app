# Call Fix: Screen Sources and Signaling Race

## Fixed issues

- `desktop:list-display-sources` could throw when `desktopCapturer` returned a source without a thumbnail or app icon.
- Early WebRTC offer / answer / ICE messages could be dropped because the React call refs were only updated after render, not at the same time as call state changes.

## Changes

- Hardened Electron source serialization in `desktop-chat-app/main.cjs` so `toDataURL()` is only called when the image handle exists.
- Updated `components/chat/useDesktopCallController.ts` to synchronize call refs immediately when call state changes.
- Added a small in-memory call snapshot map so a signal can still be matched to the correct call during short state transition races.

## Validation

- `cmd /c npx tsc --noEmit --incremental false`
- `cmd /c npm run lint`
- `cmd /c npm run build`
