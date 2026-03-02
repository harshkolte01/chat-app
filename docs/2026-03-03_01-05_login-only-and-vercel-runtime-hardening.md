# Context

Implemented final auth/page-access and deployment runtime hardening updates.

## What was changed

1. Signup page access removed from UI flow
- Updated `app/signup/page.tsx` to always redirect:
  - authenticated users -> `/chat`
  - unauthenticated users -> `/login`
- Signup API endpoint was intentionally kept unchanged.

2. Login page now only supports login
- Removed "Create an account" link from `app/login/login-form.tsx`.
- Result: users cannot navigate to signup from the app UI.

3. Vercel websocket error mitigation in chat client
- Updated `app/chat/chat-client.tsx` to disable realtime socket initialization on `*.vercel.app` hosts.
- Added bounded socket reconnect settings for non-Vercel environments (`reconnectionAttempts` and `timeout`).
- Avoided surfacing repeated socket connect errors as blocking UI errors; app continues with REST fallback mode.

4. Mixed-content legacy image URL normalization
- Added client-side normalization for image message URLs in `app/chat/chat-client.tsx`.
- Legacy stored values (including old MinIO `http://...` links or signed URLs) are mapped to local proxy paths:
  - `/api/uploads/object/<objectKey>`
- This prevents HTTPS pages from trying to load insecure HTTP image resources.

## Validation

- Ran `npm run lint` successfully after changes.
