# Emoji Picker React 19 Compatibility Fix (2026-03-04 22:30)

## Context
Fixed TypeScript errors in `components/chat/EmojiPicker.tsx` caused by importing `@emoji-mart/react` when the project currently runs React 19.

## Errors Addressed
- `TS2307`: Cannot find module `@emoji-mart/react`.
- `TS2769`: Picker props not recognized due to unresolved module/component typing.

## Root Cause
- The project had `emoji-mart` and `@emoji-mart/data` installed, but not `@emoji-mart/react`.
- Installing `@emoji-mart/react` in this setup hits peer dependency constraints (`@emoji-mart/react@1.1.1` expects React up to 18).

## Implementation
Refactored `components/chat/EmojiPicker.tsx` to use `emoji-mart` core Picker directly:
- Lazy-load `emoji-mart` module at runtime when picker opens.
- Lazy-load `@emoji-mart/data` as before.
- Instantiate `new Picker({...})` and mount into desktop/mobile host containers.
- Keep all existing UX behavior:
  - desktop anchored popover
  - mobile bottom sheet
  - outside click + Escape close
  - emoji select callback to composer input

## Validation
- `npm run lint`: passed
- `npx tsc --noEmit`: passed

## Notes
- No backend/data model changes required.
- Emojis continue to flow as Unicode text in existing message pipeline.
