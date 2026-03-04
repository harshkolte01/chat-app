# Emoji Shortcode Autocomplete in Composer (2026-03-04 22:43)

## Context
Implemented WhatsApp-style shortcode autocomplete in chat composer input so users can type patterns like `:sm` and get emoji suggestions.

## Implementation
Updated `components/chat/Composer.tsx` with headless emoji search using Emoji Mart:
- Detects active shortcode token near caret with pattern `:query` (minimum 2 chars).
- Lazy-initializes emoji search index (`emoji-mart` + `@emoji-mart/data`) only when needed.
- Shows suggestion dropdown above input while typing shortcode.
- Supports keyboard controls:
  - `ArrowDown` / `ArrowUp` to move highlight
  - `Enter` or `Tab` to insert highlighted emoji
  - `Escape` to close suggestions
- Supports mouse click insertion.
- Replaces typed shortcode token with native emoji and preserves focus/caret position.
- Keeps existing emoji picker button flow intact.
- Closes shortcode suggestions when opening picker/camera/photo or on message submit.

## UX Notes
- Input placeholder now hints usage: `use :sm for emoji`.
- Suggestions are hidden when composer is disabled or emoji picker modal is open.

## Validation
- `npm run lint`: passed
- `npx tsc --noEmit`: passed

## Backend/Data Impact
- None.
- Emojis continue as Unicode text in existing message payload and DB storage.
