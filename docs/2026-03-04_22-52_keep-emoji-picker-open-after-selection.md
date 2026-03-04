# Keep Emoji Picker Open After Selection (2026-03-04 22:52)

## Context
Improved composer emoji UX so users can insert multiple emojis consecutively without reopening the picker after each selection.

## Change
Updated `components/chat/Composer.tsx`:
- Removed auto-close behavior in `handleEmojiSelect`.
- Picker now remains open after selecting an emoji.
- Existing close paths remain intact:
  - click outside
  - Escape
  - explicit close button (mobile sheet)
  - submit message
  - opening camera/photo actions

## Why
Previous flow required reopening picker every time, which slowed down multi-emoji entry and felt unintuitive.

## Validation
- `npm run lint`: passed
- `npx tsc --noEmit`: passed
