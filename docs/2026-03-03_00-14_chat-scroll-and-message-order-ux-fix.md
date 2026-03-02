# Chat Scroll and Message Order UX Fix

## Context
- Fixed chat page expansion issue by constraining the chat shell to viewport height and moving overflow to internal panels.
- Updated message rendering order so latest messages appear at the bottom (natural chat flow), not at the top.

## What Changed
- In `app/chat/chat-client.tsx`:
  - Added fixed viewport container (`h-screen`, `overflow-hidden`) for chat page.
  - Converted main grid to `flex-1 min-h-0` so child panels stay bounded.
  - Made sidebar and message panels internally scrollable with `overflow-y-auto` and `min-h-0`.
  - Added `messageScrollRef` and auto-scroll effect to keep view pinned to bottom when conversation/newest message changes.
  - Rendered messages using reversed display array (`displayedMessages`) so chronological flow is top -> bottom and newest appears at bottom.

## Verification
- Ran `npm run lint` successfully.
