import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api/responses";
import { requirePinUnlockedApiUser } from "@/lib/auth/pin-access";
import { createImageObjectKey, createPresignedPutUrl, toPublicObjectProxyUrl } from "@/lib/storage/s3";

const ALLOWED_CONTENT_TYPE_PREFIX = "image/";
const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const auth = await requirePinUnlockedApiUser(request);
  if (auth.response) {
    return auth.response;
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return fail(400, "INVALID_FORM_DATA", "Request body must be multipart form-data.");
  }

  const fileEntry = formData.get("file");
  if (!fileEntry || typeof fileEntry === "string") {
    return fail(400, "MISSING_FILE", "Image file is required.");
  }

  const file = fileEntry as File;
  const filename = file.name?.trim() || `upload-${Date.now()}.jpg`;
  const contentType = file.type?.trim().toLowerCase() || "application/octet-stream";

  if (!contentType.startsWith(ALLOWED_CONTENT_TYPE_PREFIX)) {
    return fail(400, "INVALID_CONTENT_TYPE", "Only image uploads are allowed.");
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return fail(400, "FILE_TOO_LARGE", "Image must be smaller than 10 MB.");
  }

  let signedUploadUrl: string;
  let objectKey: string;
  try {
    objectKey = createImageObjectKey(filename, contentType);
    const signed = createPresignedPutUrl({
      objectKey,
      contentType,
    });
    signedUploadUrl = signed.uploadUrl;
  } catch {
    return fail(500, "UPLOAD_CONFIG_ERROR", "Unable to create upload URL.");
  }

  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const uploadResponse = await fetch(signedUploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
    },
    body: fileBytes,
    cache: "no-store",
  });

  if (!uploadResponse.ok) {
    return fail(502, "UPLOAD_FAILED", "Image upload failed.");
  }

  return ok({
    fileUrl: toPublicObjectProxyUrl(objectKey),
    objectKey,
    public: false,
    uploadedVia: "relay",
  });
}
