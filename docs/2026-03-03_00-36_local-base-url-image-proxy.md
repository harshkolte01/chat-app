# Local-Base-URL Image Proxy for Chat Uploads

## Context
- Updated image message URL strategy to use application-local API URLs instead of direct storage host URLs.
- Goal: avoid exposing storage IP in message payloads and support private storage access through backend-controlled reads.

## What Implemented
- Added local proxy URL generator in storage module:
  - `toPublicObjectProxyUrl(objectKey)` in `lib/storage/s3.ts`
  - Builds URL under app API path: `/api/uploads/object/<key>`
  - Uses `PUBLIC_BASE_URL` when available for absolute URL generation.
- Added presigned GET generator in `lib/storage/s3.ts`:
  - `createPresignedGetUrl(objectKey)` for private object retrieval.
- Added object proxy route:
  - `GET /api/uploads/object/[...key]`
  - Signs internal GET request to object store, fetches object server-side, and streams it to client.
  - Returns normalized content headers and short cache-control.
- Updated upload presign API output:
  - `POST /api/uploads/presign` now returns proxy-based `fileUrl` instead of direct storage host URL.
  - `public` flag switched to `false` to reflect private-read via proxy.

## Result
- New image messages are stored/rendered with local app-base URLs.
- Browser no longer depends on direct object-store URL for image display.
- Private bucket compatibility is improved through server-side fetch proxy.

## Verification
- Ran `npm run lint` successfully.
