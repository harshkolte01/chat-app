# Phase-F MinIO-Presign-Image-Upload

## Context
- Implemented Phase F image upload using a presigned URL flow with a public-bucket MVP strategy.
- Decision used: **Public bucket (MVP)**.
  - Upload object via presigned PUT.
  - Store public file URL in message `imageKey` field for immediate rendering.

## Backend Changes
- Added new upload API:
  - `POST /api/uploads/presign`
  - Input: `filename`, `contentType`
  - Output: `uploadUrl`, `fileUrl`, `objectKey`, `expiresIn`, `public`
- Added modular storage helper:
  - `lib/storage/s3.ts`
  - Generates object keys for chat images.
  - Generates AWS SigV4-compatible presigned PUT URL (manual signing, no external SDK dependency).
  - Builds public object URL for rendering.
- Updated `POST /api/messages/send` to support both text and image messages:
  - Accepts exactly one of `text` or `imageUrl/imageKey`.
  - Stores `IMAGE` messages with `imageKey` and null `text`.
- Updated conversation preview behavior for image messages:
  - Displays `[image]` instead of raw object URL in conversation list previews.

## Frontend Changes
- Updated chat composer to support image send:
  - Added `Photo` picker button.
  - Added `Camera` capture button (mobile-friendly via `capture="environment"`).
  - Added hidden file inputs for gallery/camera sources.
- Added client upload flow:
  1. Request presigned upload URL from backend.
  2. Upload selected file via HTTP PUT.
  3. Send chat message with type `IMAGE` using uploaded file URL.
- Added image rendering in message bubbles with clickable preview.
- Added basic client-side image validation:
  - Must be `image/*`
  - Max size: 10 MB
- Preserved socket-first messaging with REST fallback for image send.

## Verification
- Ran `npm run lint` successfully.
- Build-level flow now supports:
  - text messages
  - image messages
  - mobile camera capture upload
