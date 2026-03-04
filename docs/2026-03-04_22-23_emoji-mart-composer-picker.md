# Emoji Mart Composer Picker (2026-03-04 22:23)

## Context
Implemented a production-ready emoji picker in chat composer using `emoji-mart` with a modular structure and responsive UX:
- Desktop: popover anchored to emoji button.
- Mobile: bottom sheet (full width) with backdrop.
- Emoji insertion into controlled message input while preserving cursor position.
- Input focus is restored after emoji selection.
- Emojis are sent as normal Unicode text with no backend/data model changes.

## Files Added
- `components/chat/EmojiPicker.tsx`
  - Wrapper around Emoji Mart.
  - Lazy-loads picker UI (`@emoji-mart/react`) and emoji dataset (`@emoji-mart/data`) only when opened.
  - Handles outside click and `Escape` close behavior.
  - Provides desktop popover and mobile bottom sheet rendering.
- `components/chat/Composer.tsx`
  - New modular composer UI with Photo, Camera, Emoji, text input, and Send controls.
  - Integrates `EmojiPicker` and inserts selected emoji at current caret location.
  - Keeps controlled input behavior via `draft` + `onDraftChange` from parent.

## Files Updated
- `app/chat/chat-client.tsx`
  - Replaced inline composer form with `Composer` component.
  - Kept existing send/upload/camera business logic intact.
- `package.json` / `package-lock.json`
  - Added dependencies: `emoji-mart`, `@emoji-mart/data`.

## Validation
- `npm run lint`: Passed.
- `npm run build`: Blocked by network restriction while downloading Prisma engine binary (`binaries.prisma.sh`), unrelated to emoji integration.

## Notes
- Data/backend impact: none; Unicode emojis are handled in existing text message pipeline.
- UX behavior aligns with plan: categories/search/recent/skin tones are provided by Emoji Mart defaults.
