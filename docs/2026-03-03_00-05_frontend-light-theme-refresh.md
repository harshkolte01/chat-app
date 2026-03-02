# Frontend Light Theme Refresh

## Context
- Converted the UI to a strict light theme with black-first typography and removed automatic dark-mode switching.
- Added a professional typography system using `Source Sans 3` (body) and `Sora` (headings) via `next/font/google`.
- Updated login and signup screens with cleaner visual hierarchy, stronger black text contrast, and responsive spacing for mobile, laptop, and desktop widths.
- Redesigned the chat shell for a professional light look:
  - responsive header and action controls,
  - conversation list that scrolls horizontally on smaller screens and switches to a sidebar on larger screens,
  - message area and composer optimized for narrow and wide viewports.
- Kept existing chat functionality and realtime behavior unchanged while improving visual consistency.

## Verification
- Ran `npm run lint` successfully after UI updates.
