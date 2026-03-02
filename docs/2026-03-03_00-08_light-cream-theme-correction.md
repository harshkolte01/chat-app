# Light Cream Theme Correction

## Context
- Reworked the frontend theme to be explicitly light/cream and removed dark-looking surface styles from auth and chat screens.
- Forced light color-scheme globally (`html` style + CSS root) to prevent dark rendering behavior.
- Updated global palette toward white/cream tones:
  - page background, surface, muted surface, border, and accent soft colors.
- Replaced variable-based Tailwind arbitrary color classes on UI surfaces with explicit utility colors (`bg-white`, `bg-stone-100`, `bg-amber-100`, `border-stone-*`) for predictable rendering.
- Updated Login and Signup:
  - white/cream cards and side panels,
  - black text for all headings/labels/body,
  - cream action buttons with black text.
- Updated Chat UI:
  - white header/sidebar/content cards,
  - cream selected conversation and outgoing message bubble,
  - cream buttons and black text throughout.

## Verification
- Ran `npm run lint` successfully after changes.
