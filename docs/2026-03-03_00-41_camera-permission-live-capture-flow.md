# Camera Permission and Live Capture Flow

## Context
- Replaced the basic camera file-input behavior with an interactive live camera capture flow.
- Requirement addressed: when user taps camera, browser should request camera permission, open camera view, allow front/back switching, capture photo, and send in chat.

## What Implemented
- Updated `app/chat/chat-client.tsx` camera behavior:
  - Added `getUserMedia` based camera modal.
  - Camera button now opens live camera session (permission prompt handled by browser).
  - Added camera stream management with proper cleanup (`stop tracks` on close/unmount).
  - Added facing mode switch between front and back camera.
  - Added capture button that grabs frame from `<video>` into a canvas blob and uploads as image message.
- Refactored image upload flow:
  - Shared `processImageFile()` pipeline now used by both gallery selection and camera capture.
- Added error handling for camera access failures:
  - permission denied,
  - camera unavailable,
  - camera not supported.

## UX Result
- `Photo`: opens gallery/file picker.
- `Camera`: asks permission -> opens live preview -> user can switch front/back -> capture & send.

## Verification
- Ran `npm run lint` successfully.
