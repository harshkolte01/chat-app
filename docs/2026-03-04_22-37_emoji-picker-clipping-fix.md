# Emoji Picker Clipping and Truncation Fix (2026-03-04 22:37)

## Context
Fixed UI issue where desktop emoji picker appeared partially cut/truncated ("half missing") in chat composer.

## Root Cause
Desktop picker was positioned inside a container hierarchy that can apply clipping/overflow behavior. In some viewport/layout combinations this caused the picker to render partially outside visible bounds.

## Implementation
Updated `components/chat/EmojiPicker.tsx`:
- Render desktop picker via portal (`createPortal`) into `document.body`.
- Use fixed-position popover anchored to emoji button coordinates.
- Add viewport-aware position logic:
  - clamps horizontal position to viewport margins
  - flips below anchor when there is not enough space above
- Keep mobile bottom-sheet implementation unchanged.
- Enable `dynamicWidth` in Emoji Mart picker props so picker fits host width consistently.
- Keep outside-click and Escape-to-close behavior across portal/mobile containers.

## Validation
- `npm run lint`: passed
- `npx tsc --noEmit`: passed

## Notes
- This is a UI-layer fix only.
- Message send/storage behavior is unchanged (Unicode emoji text flow remains intact).
