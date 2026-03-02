# Context

Implemented smart polling fallback for chat updates when realtime socket is unavailable (for example on Vercel deployment).

## What was implemented

1. Smart polling behavior in chat client
- Added fallback polling for conversations and current messages only when socket is disconnected.
- Polling only runs when:
  - browser is online
  - tab is visible
  - there is an active selected conversation (for message polling)
- Polling pauses automatically when tab is hidden or browser is offline.

2. Optimized polling intervals and resilience
- Message polling interval: ~2.5 seconds.
- Conversation polling interval: ~12 seconds.
- Added exponential backoff on polling failures with an upper cap.
- This reduces unnecessary request volume during outages.

3. Silent refresh mode (no UI flicker)
- Enhanced `loadConversations` and `loadMessages` with a silent mode used by polling.
- Silent mode avoids resetting loading spinners/error banner on every poll cycle.
- Full loading behavior is retained for explicit user-triggered loads.

4. Message merge strategy for polled updates
- Added merge logic for message polling:
  - deduplicates by message ID
  - keeps latest server state for overlapping items
  - preserves previously loaded older messages
  - sorts messages newest-first for consistent rendering

5. Realtime status text update
- Header status now reflects effective mode:
  - `connected`
  - `polling fallback active`
  - `paused (tab hidden)`
  - `offline`

## Validation

- Ran `npm run lint` successfully after implementation.
