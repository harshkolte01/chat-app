# MinIO Upload Error Diagnosis and URL Path Fix

## Context
- Investigated image upload failure shown as browser console error: `PUT ... net::ERR_CONNECTION_RESET` with UI message `Failed to fetch`.
- Confirmed failure occurs on direct browser upload call to object storage endpoint, before message creation.

## Findings
- Error indicates network/socket-level connection reset from storage endpoint (not application JSON/API validation failure).
- Bucket access mode (`PRIVATE`) does not by itself cause `ERR_CONNECTION_RESET`; private mode mainly affects direct object read visibility.
- Upload URL previously contained a double slash before bucket path (`//bucket/...`) due endpoint root-path normalization behavior.

## Fix Implemented
- Updated `lib/storage/s3.ts` path assembly logic to avoid accidental double slashes in presigned/upload/public URLs.
- Refactored endpoint config handling:
  - explicit origin/host/basePath fields,
  - robust object path construction from clean path segments,
  - preserved signing behavior.

## Verification
- Ran `npm run lint` successfully.

## Notes
- This code fix removes malformed URL paths.
- If connection reset persists, endpoint reachability / port / proxy / firewall at storage host must be validated outside app code.
