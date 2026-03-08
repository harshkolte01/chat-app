import { NextRequest } from "next/server";
import { fail } from "@/lib/api/responses";
import { requirePinUnlockedApiUser } from "@/lib/auth/pin-access";
import { createPresignedGetUrl } from "@/lib/storage/s3";

type RouteContext = {
  params: Promise<{ key: string[] }> | { key: string[] };
};

const PROXY_CACHE_SECONDS = 60;
const PRESIGNED_GET_SECONDS = 120;

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requirePinUnlockedApiUser(request);
  if (auth.response) {
    return auth.response;
  }

  const params = await Promise.resolve(context.params);
  const keyParts = params.key ?? [];
  const objectKey = keyParts.join("/").trim();

  if (!objectKey) {
    return fail(400, "MISSING_OBJECT_KEY", "Object key is required.");
  }

  let signedUrl: string;
  try {
    signedUrl = createPresignedGetUrl({
      objectKey,
      expiresInSeconds: PRESIGNED_GET_SECONDS,
    });
  } catch {
    return fail(500, "UPLOAD_CONFIG_ERROR", "Unable to resolve object URL.");
  }

  const upstream = await fetch(signedUrl, {
    method: "GET",
    cache: "no-store",
  });

  if (!upstream.ok) {
    if (upstream.status === 404) {
      return fail(404, "OBJECT_NOT_FOUND", "Image not found.");
    }

    if (upstream.status === 403) {
      return fail(403, "OBJECT_FORBIDDEN", "Image access denied.");
    }

    return fail(502, "OBJECT_FETCH_FAILED", "Unable to fetch image.");
  }

  const headers = new Headers();
  const passthroughHeaders = ["content-type", "content-length", "etag", "last-modified"];
  for (const headerName of passthroughHeaders) {
    const value = upstream.headers.get(headerName);
    if (value) {
      headers.set(headerName, value);
    }
  }

  headers.set("cache-control", `private, max-age=${PROXY_CACHE_SECONDS}`);

  return new Response(upstream.body, {
    status: 200,
    headers,
  });
}
