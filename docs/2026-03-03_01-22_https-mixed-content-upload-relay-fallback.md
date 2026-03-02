# Context

Fixed HTTPS mixed-content upload failures for camera/photo messages when object storage upload URL is HTTP.

## Problem

- On HTTPS deployments, browser blocked direct image upload requests to insecure HTTP object-store upload URLs.
- This happened during camera/photo send flow because presigned PUT upload URL used an insecure origin.

## What was implemented

1. Added server relay upload endpoint
- New API route: `POST /api/uploads/relay`
- Accepts multipart form-data image file.
- Validates auth, image type, and size limits.
- Server uploads file to object store using presigned PUT URL.
- Returns app-local `fileUrl` (proxy path) and `objectKey`.

2. Added smart client fallback for insecure upload URLs
- In `app/chat/chat-client.tsx`, upload flow now:
  - Calls presign endpoint as before.
  - If page is HTTPS and presigned upload URL is HTTP, it uses relay endpoint automatically.
  - If direct upload attempt fails and URL is HTTP, it retries via relay.

## Result

- Camera/photo upload works on HTTPS pages without mixed-content browser block.
- Message image URL still uses local app proxy path for rendering.

## Validation

- Ran `npm run lint` successfully.
