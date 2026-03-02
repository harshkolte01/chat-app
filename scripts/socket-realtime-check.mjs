import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { io } from "socket.io-client";

const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const SERVER_START_TIMEOUT_MS = 120_000;
const SERVER_POLL_INTERVAL_MS = 1_000;
const SOCKET_EVENT_TIMEOUT_MS = 10_000;

function loadEnvFile(path = ".env") {
  try {
    const content = readFileSync(path, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }

      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      let value = line.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // No-op when .env is missing.
  }
}

function parseBaseUrl() {
  const envUrl = process.env.API_BASE_URL ?? process.env.BASE_URL ?? "";
  if (!envUrl) {
    return DEFAULT_BASE_URL;
  }

  try {
    return new URL(envUrl).toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_BASE_URL;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function logStep(step, message) {
  console.log(`\n[${step}] ${message}`);
}

function parseSetCookieValue(headerValue) {
  const [pair] = headerValue.split(";");
  const index = pair.indexOf("=");
  if (index <= 0) {
    return null;
  }

  const name = pair.slice(0, index).trim();
  const value = pair.slice(index + 1).trim();
  if (!name) {
    return null;
  }

  return { name, value };
}

class HttpClient {
  constructor(baseUrl, label) {
    this.baseUrl = baseUrl;
    this.label = label;
    this.cookies = new Map();
  }

  cookieHeader() {
    return [...this.cookies.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  storeCookies(response) {
    const getSetCookie = response.headers.getSetCookie?.bind(response.headers);
    const headerValues = getSetCookie ? getSetCookie() : [];
    if (headerValues.length === 0) {
      const single = response.headers.get("set-cookie");
      if (single) {
        headerValues.push(single);
      }
    }

    for (const headerValue of headerValues) {
      const cookie = parseSetCookieValue(headerValue);
      if (!cookie) {
        continue;
      }
      this.cookies.set(cookie.name, cookie.value);
    }
  }

  async request(method, path, options = {}) {
    const headers = {};
    if (options.json !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const cookieHeader = this.cookieHeader();
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: options.json !== undefined ? JSON.stringify(options.json) : undefined,
      redirect: "manual",
    });

    this.storeCookies(response);
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    const expectedStatus = options.expectedStatus ?? null;
    if (
      expectedStatus !== null &&
      !(
        (Array.isArray(expectedStatus) && expectedStatus.includes(response.status)) ||
        (!Array.isArray(expectedStatus) && expectedStatus === response.status)
      )
    ) {
      throw new Error(
        `${this.label} ${method} ${path} expected ${JSON.stringify(
          expectedStatus,
        )}, got ${response.status}. Payload: ${JSON.stringify(data)}`,
      );
    }

    return { status: response.status, data };
  }
}

async function waitForServer(baseUrl) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < SERVER_START_TIMEOUT_MS) {
    try {
      const response = await fetch(`${baseUrl}/api/me`, { method: "GET", redirect: "manual" });
      if (response.status === 200 || response.status === 401) {
        return true;
      }
    } catch {
      // Retry.
    }
    await delay(SERVER_POLL_INTERVAL_MS);
  }
  return false;
}

function startServer() {
  const child = spawn("cmd", ["/c", "npm", "run", "dev", "--", "--hostname", "127.0.0.1", "--port", "3000"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[server] ${chunk.toString()}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[server:err] ${chunk.toString()}`);
  });

  return child;
}

function createSocket(baseUrl, cookieHeader) {
  return io(baseUrl, {
    path: "/api/socket/io",
    transports: ["websocket", "polling"],
    extraHeaders: {
      Cookie: cookieHeader,
    },
    reconnection: false,
  });
}

function waitForSocketConnect(socket, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${label} socket connect timeout.`));
    }, SOCKET_EVENT_TIMEOUT_MS);

    const onConnect = () => {
      cleanup();
      resolve(undefined);
    };

    const onError = (error) => {
      cleanup();
      reject(new Error(`${label} socket connection failed: ${error.message}`));
    };

    function cleanup() {
      clearTimeout(timer);
      socket.off("connect", onConnect);
      socket.off("connect_error", onError);
    }

    socket.on("connect", onConnect);
    socket.on("connect_error", onError);
  });
}

function waitForEvent(socket, eventName, predicate, timeoutMs = SOCKET_EVENT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout waiting for event ${eventName}.`));
    }, timeoutMs);

    const handler = (payload) => {
      if (predicate && !predicate(payload)) {
        return;
      }
      cleanup();
      resolve(payload);
    };

    function cleanup() {
      clearTimeout(timer);
      socket.off(eventName, handler);
    }

    socket.on(eventName, handler);
  });
}

function emitWithAck(socket, eventName, payload, timeoutMs = SOCKET_EVENT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error(`Timeout waiting for ack on ${eventName}.`));
    }, timeoutMs);

    socket.emit(eventName, payload, (response) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(response);
    });
  });
}

async function run() {
  loadEnvFile();
  const baseUrl = parseBaseUrl();
  const inviteCode = process.env.INVITE_CODE;
  const autoStartServer =
    process.env.AUTO_START_SERVER === "1" || process.env.AUTO_START_SERVER === "true";

  assert(Boolean(inviteCode), "INVITE_CODE is required.");
  let startedServer = null;
  let aliceSocket = null;
  let bobSocket = null;

  try {
    logStep("Setup", `Using base URL: ${baseUrl}`);
    const available = await waitForServer(baseUrl);
    if (!available && autoStartServer) {
      logStep("Server", "Server not reachable. Starting local Next.js dev server.");
      startedServer = startServer();
      const ready = await waitForServer(baseUrl);
      assert(ready, "Server did not become ready in time.");
    } else if (!available) {
      throw new Error(
        `Server is not reachable at ${baseUrl}. Start it first or set AUTO_START_SERVER=1.`,
      );
    }

    const suffix = `${Date.now()}_${Math.floor(Math.random() * 10_000)}`;
    const alice = {
      username: `socket_alice_${suffix}`,
      email: `socket_alice_${suffix}@example.com`,
      password: "Password123!",
    };
    const bob = {
      username: `socket_bob_${suffix}`,
      email: `socket_bob_${suffix}@example.com`,
      password: "Password123!",
    };

    const aliceHttp = new HttpClient(baseUrl, "alice");
    const bobHttp = new HttpClient(baseUrl, "bob");

    logStep("Auth", "Signup two accounts and create conversation.");
    const signupAlice = await aliceHttp.request("POST", "/api/auth/signup", {
      expectedStatus: 201,
      json: {
        username: alice.username,
        email: alice.email,
        password: alice.password,
        accessCode: inviteCode,
      },
    });
    assert(signupAlice.data?.user?.id, "Alice signup failed.");

    const signupBob = await bobHttp.request("POST", "/api/auth/signup", {
      expectedStatus: 201,
      json: {
        username: bob.username,
        email: bob.email,
        password: bob.password,
        accessCode: inviteCode,
      },
    });
    assert(signupBob.data?.user?.id, "Bob signup failed.");
    const bobId = signupBob.data.user.id;

    const conversation = await aliceHttp.request("POST", "/api/conversations", {
      expectedStatus: [200, 201],
      json: { otherUserId: bobId },
    });
    const conversationId = conversation.data?.conversationId;
    assert(conversationId, "Conversation creation failed.");

    logStep("Socket", "Bootstrapping Socket.IO route and connecting both clients.");
    await aliceHttp.request("GET", "/api/socket", { expectedStatus: 200 });

    aliceSocket = createSocket(baseUrl, aliceHttp.cookieHeader());
    bobSocket = createSocket(baseUrl, bobHttp.cookieHeader());

    await Promise.all([
      waitForSocketConnect(aliceSocket, "alice"),
      waitForSocketConnect(bobSocket, "bob"),
    ]);

    logStep("Realtime", "Testing online send -> delivered -> read flow.");
    const clientMessageId = `socket-client-${Date.now()}`;

    const bobIncomingPromise = waitForEvent(
      bobSocket,
      "chat:new_message",
      (payload) => payload.message.conversationId === conversationId,
    );
    const deliveredStatusPromise = waitForEvent(
      aliceSocket,
      "chat:message_status_updated",
      (payload) => payload.conversationId === conversationId && payload.status === "DELIVERED",
    );

    const sendAck = await emitWithAck(aliceSocket, "chat:send_message", {
      conversationId,
      type: "text",
      text: "Realtime hello from Alice",
      clientMessageId,
    });
    assert(sendAck?.ok === true, `Send ack failed: ${JSON.stringify(sendAck)}`);

    const bobIncoming = await bobIncomingPromise;
    assert(
      bobIncoming?.message?.id === sendAck.data.message.id,
      "Bob received unexpected message id.",
    );

    const deliveredAck = await emitWithAck(bobSocket, "chat:message_delivered", {
      messageId: bobIncoming.message.id,
    });
    assert(deliveredAck?.ok === true, "message_delivered ack failed.");

    const deliveredStatus = await deliveredStatusPromise;
    assert(deliveredStatus.messageId === bobIncoming.message.id, "Delivered status update mismatch.");

    const readStatusPromise = waitForEvent(
      aliceSocket,
      "chat:message_status_updated",
      (payload) => payload.conversationId === conversationId && payload.status === "READ",
    );
    const readAck = await emitWithAck(bobSocket, "chat:message_read", {
      conversationId,
      lastReadMessageId: bobIncoming.message.id,
    });
    assert(readAck?.ok === true, "message_read ack failed.");

    const readStatus = await readStatusPromise;
    assert(readStatus.messageId === bobIncoming.message.id, "Read status update mismatch.");

    const messagesAfterRead = await aliceHttp.request(
      "GET",
      `/api/messages?conversationId=${encodeURIComponent(conversationId)}`,
      { expectedStatus: 200 },
    );
    const readMessage = messagesAfterRead.data?.messages?.find(
      (item) => item.id === bobIncoming.message.id,
    );
    assert(readMessage?.status === "READ", "Expected message status READ after read ack.");

    logStep("Realtime", "Testing no delivered ack keeps status as SENT.");
    const noAckIncomingPromise = waitForEvent(
      bobSocket,
      "chat:new_message",
      (payload) => payload.message.conversationId === conversationId,
    );

    const sendAckNoDelivery = await emitWithAck(aliceSocket, "chat:send_message", {
      conversationId,
      type: "text",
      text: "No delivery ack message",
      clientMessageId: `socket-no-ack-${Date.now()}`,
    });
    assert(sendAckNoDelivery?.ok === true, "Send ack for no-ack scenario failed.");

    await noAckIncomingPromise;
    await delay(1_000);

    const messagesAfterNoAck = await aliceHttp.request(
      "GET",
      `/api/messages?conversationId=${encodeURIComponent(conversationId)}`,
      { expectedStatus: 200 },
    );
    const noAckMessage = messagesAfterNoAck.data?.messages?.find(
      (item) => item.id === sendAckNoDelivery.data.message.id,
    );
    assert(noAckMessage?.status === "SENT", "Expected status SENT when receiver does not ack.");

    console.log("\nSocket realtime checks passed.");
    console.log(`Conversation: ${conversationId}`);
    console.log(`Delivered/read message: ${bobIncoming.message.id}`);
    console.log(`No-ack message remained SENT: ${sendAckNoDelivery.data.message.id}`);
  } finally {
    if (aliceSocket) {
      aliceSocket.removeAllListeners();
      aliceSocket.disconnect();
    }
    if (bobSocket) {
      bobSocket.removeAllListeners();
      bobSocket.disconnect();
    }

    if (startedServer) {
      logStep("Cleanup", "Stopping local dev server started by script.");
      startedServer.kill("SIGTERM");
      await delay(500);
    }
  }
}

run().catch((error) => {
  console.error("\nSocket realtime check failed:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
