import "dotenv/config";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "../../lib/db";
import {
  DEFAULT_REALTIME_SOCKET_PATH,
  normalizeRealtimeSocketPath,
} from "../../lib/realtime/config";
import { createSocketServer } from "../../lib/socket/server";

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function resolveAllowedOrigins(): string[] {
  const explicit = process.env.REALTIME_CORS_ORIGIN?.trim();
  if (explicit) {
    return unique(
      explicit
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    );
  }

  const defaults = unique(
    [
      process.env.PUBLIC_BASE_URL?.trim() ?? "",
      process.env.NEXT_APP_URL?.trim() ?? "",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ].filter(Boolean),
  );

  if (defaults.length > 0) {
    return defaults;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "REALTIME_CORS_ORIGIN or PUBLIC_BASE_URL / NEXT_APP_URL must be configured for the realtime server.",
    );
  }

  return ["http://localhost:3000", "http://127.0.0.1:3000"];
}

function writeJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

const host = process.env.HOST?.trim() || process.env.REALTIME_HOST?.trim() || "0.0.0.0";
const port = parsePort(process.env.PORT ?? process.env.REALTIME_PORT, 3001);
const socketPath = normalizeRealtimeSocketPath(
  process.env.REALTIME_SOCKET_PATH ?? DEFAULT_REALTIME_SOCKET_PATH,
);
const allowedOrigins = resolveAllowedOrigins();
const startedAt = new Date();

const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  const method = req.method ?? "GET";
  const url = req.url ?? "/";

  if (method === "GET" && (url === "/" || url.startsWith("/healthz"))) {
    return writeJson(res, 200, {
      ok: true,
      service: "sec-chat-realtime",
      socketPath,
      uptimeSeconds: Math.floor(process.uptime()),
      startedAt: startedAt.toISOString(),
    });
  }

  return writeJson(res, 404, {
    error: {
      code: "NOT_FOUND",
      message: "Route not found.",
    },
  });
});

const io = createSocketServer(httpServer, {
  path: socketPath,
  corsOrigin: allowedOrigins,
});

let shuttingDown = false;

async function shutdown(signal: string, exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`[realtime] shutting down (${signal})`);

  await new Promise<void>((resolve) => {
    io.close(() => resolve());
  });

  await new Promise<void>((resolve) => {
    httpServer.close(() => resolve());
  });

  await prisma.$disconnect().catch((error: unknown) => {
    console.error("[realtime] prisma disconnect failed:", error);
  });

  process.exit(exitCode);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("unhandledRejection", (reason) => {
  console.error("[realtime] unhandled rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[realtime] uncaught exception:", error);
  void shutdown("uncaughtException", 1);
});

httpServer.listen(port, host, () => {
  console.log(
    `[realtime] listening on http://${host}:${port} with path ${socketPath} for origins: ${allowedOrigins.join(", ")}`,
  );
});
