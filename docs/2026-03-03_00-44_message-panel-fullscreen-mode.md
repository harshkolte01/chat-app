# Message-Panel-Fullscreen-Mode

## Context
- Added fullscreen mode for the message panel only to make chatting easier.
- Fullscreen mode hides non-essential surrounding layout and keeps focus on active conversation.

## What Implemented
- Updated `app/chat/chat-client.tsx`:
  - Added `messagePanelFullscreen` state.
  - Added `Full screen` / `Exit full screen` toggle button in message panel header.
  - While fullscreen is active:
    - top workspace header is hidden,
    - left sidebar panel is hidden,
    - message panel is promoted to fixed viewport overlay (`inset` layout).
  - Added `Esc` key support to exit fullscreen quickly.
  - Added temporary body scroll lock during fullscreen mode.

## Verification
- Ran `npm run lint` successfully.
