import { createHash, createHmac, randomUUID } from "node:crypto";

const PRESIGN_EXPIRATION_SECONDS = 900;
const DEFAULT_IMAGE_EXTENSION = "jpg";

type S3Config = {
  endpointOrigin: string;
  endpointHost: string;
  endpointBasePath: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

type PresignedPutInput = {
  objectKey: string;
  contentType: string;
  expiresInSeconds?: number;
};

type PresignedPutOutput = {
  uploadUrl: string;
  objectKey: string;
  fileUrl: string;
  expiresIn: number;
};

type PresignedGetInput = {
  objectKey: string;
  expiresInSeconds?: number;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (match) =>
    `%${match.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function hmacSha256(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function getSignatureKey(secretAccessKey: string, dateStamp: string, region: string): Buffer {
  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, "s3");
  return hmacSha256(kService, "aws4_request");
}

function toAmzDateParts(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  };
}

function getS3Config(): S3Config {
  const endpoint = new URL(requiredEnv("S3_ENDPOINT"));
  const endpointBasePath =
    endpoint.pathname === "/" ? "" : endpoint.pathname.replace(/\/+$/, "");

  return {
    endpointOrigin: `${endpoint.protocol}//${endpoint.host}`,
    endpointHost: endpoint.host,
    endpointBasePath,
    region: requiredEnv("S3_REGION"),
    accessKeyId: requiredEnv("S3_ACCESS_KEY"),
    secretAccessKey: requiredEnv("S3_SECRET_KEY"),
    bucket: requiredEnv("S3_BUCKET"),
  };
}

function getSafeFileStem(filename: string): string {
  const stripped = filename
    .trim()
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return stripped.slice(0, 40) || "image";
}

function getExtension(filename: string, contentType: string): string {
  const extFromName = filename.split(".").pop()?.toLowerCase();
  if (extFromName && /^[a-z0-9]{2,8}$/.test(extFromName)) {
    return extFromName;
  }

  const byType: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/heic": "heic",
    "image/heif": "heif",
  };

  return byType[contentType.toLowerCase()] ?? DEFAULT_IMAGE_EXTENSION;
}

function buildObjectPath(basePath: string, bucket: string, objectKey: string): string {
  const segments = [
    ...basePath.split("/").filter(Boolean),
    bucket,
    ...objectKey.split("/").filter(Boolean),
  ];

  return `/${segments.map(encodeRfc3986).join("/")}`;
}

export function createImageObjectKey(filename: string, contentType: string): string {
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const stem = getSafeFileStem(filename);
  const extension = getExtension(filename, contentType);

  return `chat-images/${year}/${month}/${day}/${randomUUID()}-${stem}.${extension}`;
}

export function toPublicObjectProxyUrl(objectKey: string): string {
  const encoded = objectKey
    .split("/")
    .filter(Boolean)
    .map(encodeRfc3986)
    .join("/");
  const relativePath = `/api/uploads/object/${encoded}`;
  const baseUrl = process.env.PUBLIC_BASE_URL?.trim();

  if (!baseUrl) {
    return relativePath;
  }

  return `${baseUrl.replace(/\/+$/, "")}${relativePath}`;
}

export function createPresignedPutUrl(input: PresignedPutInput): PresignedPutOutput {
  const config = getS3Config();
  const expiresIn = input.expiresInSeconds ?? PRESIGN_EXPIRATION_SECONDS;
  const now = new Date();
  const { amzDate, dateStamp } = toAmzDateParts(now);
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const objectPath = buildObjectPath(config.endpointBasePath, config.bucket, input.objectKey);

  const signedHeaders = "content-type;host";
  const canonicalHeaders = `content-type:${input.contentType}\nhost:${config.endpointHost}\n`;

  const queryParams = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresIn),
    "X-Amz-SignedHeaders": signedHeaders,
  });

  const sortedQuery = [...queryParams.entries()]
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join("&");

  const canonicalRequest = [
    "PUT",
    objectPath,
    sortedQuery,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signature = createHmac("sha256", getSignatureKey(config.secretAccessKey, dateStamp, config.region))
    .update(stringToSign, "utf8")
    .digest("hex");

  const uploadUrl = `${config.endpointOrigin}${objectPath}?${sortedQuery}&X-Amz-Signature=${signature}`;
  const fileUrl = `${config.endpointOrigin}${objectPath}`;

  return {
    uploadUrl,
    fileUrl,
    objectKey: input.objectKey,
    expiresIn,
  };
}

export function createPresignedGetUrl(input: PresignedGetInput): string {
  const config = getS3Config();
  const expiresIn = input.expiresInSeconds ?? PRESIGN_EXPIRATION_SECONDS;
  const now = new Date();
  const { amzDate, dateStamp } = toAmzDateParts(now);
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const objectPath = buildObjectPath(config.endpointBasePath, config.bucket, input.objectKey);

  const signedHeaders = "host";
  const canonicalHeaders = `host:${config.endpointHost}\n`;

  const queryParams = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresIn),
    "X-Amz-SignedHeaders": signedHeaders,
  });

  const sortedQuery = [...queryParams.entries()]
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join("&");

  const canonicalRequest = [
    "GET",
    objectPath,
    sortedQuery,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signature = createHmac("sha256", getSignatureKey(config.secretAccessKey, dateStamp, config.region))
    .update(stringToSign, "utf8")
    .digest("hex");

  return `${config.endpointOrigin}${objectPath}?${sortedQuery}&X-Amz-Signature=${signature}`;
}
