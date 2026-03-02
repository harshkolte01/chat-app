import { NextRequest } from "next/server";
import { fail, ok, parseJsonBody } from "@/lib/api/responses";
import { getCurrentUserFromRequest } from "@/lib/auth/current-user";
import { createImageObjectKey, createPresignedPutUrl, toPublicObjectProxyUrl } from "@/lib/storage/s3";

type PresignBody = {
  filename?: string;
  contentType?: string;
};

const MAX_FILENAME_LENGTH = 180;
const ALLOWED_CONTENT_TYPE_PREFIX = "image/";

export async function POST(request: NextRequest) {
  const currentUser = await getCurrentUserFromRequest(request);
  if (!currentUser) {
    return fail(401, "UNAUTHORIZED", "Authentication required.");
  }

  const body = await parseJsonBody<PresignBody>(request);
  if (!body) {
    return fail(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const filename = body.filename?.trim();
  const contentType = body.contentType?.trim().toLowerCase();

  if (!filename || !contentType) {
    return fail(400, "MISSING_FIELDS", "filename and contentType are required.");
  }

  if (filename.length > MAX_FILENAME_LENGTH) {
    return fail(400, "INVALID_FILENAME", "filename is too long.");
  }

  if (!contentType.startsWith(ALLOWED_CONTENT_TYPE_PREFIX)) {
    return fail(400, "INVALID_CONTENT_TYPE", "Only image uploads are allowed.");
  }

  try {
    const objectKey = createImageObjectKey(filename, contentType);
    const signed = createPresignedPutUrl({
      objectKey,
      contentType,
    });

    return ok({
      uploadUrl: signed.uploadUrl,
      fileUrl: toPublicObjectProxyUrl(signed.objectKey),
      objectKey: signed.objectKey,
      expiresIn: signed.expiresIn,
      public: false,
    });
  } catch {
    return fail(500, "UPLOAD_CONFIG_ERROR", "Unable to create upload URL.");
  }
}
