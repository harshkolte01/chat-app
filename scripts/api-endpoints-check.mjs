import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const SERVER_START_TIMEOUT_MS = 120_000;
const SERVER_POLL_INTERVAL_MS = 1_000;

function loadEnvFile(path = ".env") {
  try {
    const content = readFileSync(path, "utf8");
    const lines = content.split(/\r?\n/);

    for (const rawLine of lines) {
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
    // Ignore missing .env file and rely on process environment.
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

function logStep(step, message) {
  console.log(`\n[${step}] ${message}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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
    const parts = [];
    for (const [name, value] of this.cookies.entries()) {
      parts.push(`${name}=${value}`);
    }
    return parts.join("; ");
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
    const url = `${this.baseUrl}${path}`;
    const headers = {};
    const expectedStatus = options.expectedStatus ?? null;

    if (options.json !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const cookieHeader = this.cookieHeader();
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }

    const response = await fetch(url, {
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
      const response = await fetch(`${baseUrl}/api/me`, {
        method: "GET",
        redirect: "manual",
      });

      if (response.status === 200 || response.status === 401) {
        return true;
      }
    } catch {
      // Retry until timeout.
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

async function run() {
  loadEnvFile();

  const baseUrl = parseBaseUrl();
  const autoStartServer =
    process.env.AUTO_START_SERVER === "1" || process.env.AUTO_START_SERVER === "true";
  const inviteCode = process.env.INVITE_CODE;
  assert(Boolean(inviteCode), "INVITE_CODE is required in environment.");

  let startedServer = null;

  try {
    logStep("Setup", `Using base URL: ${baseUrl}`);

    const alreadyRunning = await waitForServer(baseUrl);
    if (!alreadyRunning && autoStartServer) {
      logStep("Server", "Server not reachable. Starting local Next.js dev server.");
      startedServer = startServer();
      const ready = await waitForServer(baseUrl);
      assert(ready, `Server did not become ready within ${SERVER_START_TIMEOUT_MS}ms.`);
    } else if (!alreadyRunning && !autoStartServer) {
      throw new Error(
        `Server is not reachable at ${baseUrl}. Start it first (npm run dev -- --hostname 127.0.0.1 --port 3000), or run with AUTO_START_SERVER=1.`,
      );
    } else {
      logStep("Server", "Server is already running.");
    }

    const suffix = `${Date.now()}_${Math.floor(Math.random() * 10_000)}`;
    const alice = {
      username: `alice_${suffix}`,
      email: `alice_${suffix}@example.com`,
      password: "Password123!",
    };
    const bob = {
      username: `bob_${suffix}`,
      email: `bob_${suffix}@example.com`,
      password: "Password123!",
    };

    const guest = new HttpClient(baseUrl, "guest");
    const aliceClient = new HttpClient(baseUrl, "alice");
    const bobClient = new HttpClient(baseUrl, "bob");

    logStep("Auth", "Checking unauthenticated /api/me");
    await guest.request("GET", "/api/me", { expectedStatus: 401 });

    logStep("Auth", "Creating first account with signup");
    const signupAlice = await aliceClient.request("POST", "/api/auth/signup", {
      expectedStatus: 201,
      json: {
        username: alice.username,
        email: alice.email,
        password: alice.password,
        accessCode: inviteCode,
      },
    });
    assert(signupAlice.data?.user?.id, "Signup did not return alice user id.");
    const aliceId = signupAlice.data.user.id;

    logStep("Auth", "Validating /api/me for first account");
    const meAlice = await aliceClient.request("GET", "/api/me", { expectedStatus: 200 });
    assert(meAlice.data?.user?.id === aliceId, "Alice /api/me returned unexpected user.");

    logStep("Auth", "Testing logout/login flow for first account");
    await aliceClient.request("POST", "/api/auth/logout", { expectedStatus: 200 });
    await aliceClient.request("GET", "/api/me", { expectedStatus: 401 });
    await aliceClient.request("POST", "/api/auth/login", {
      expectedStatus: 200,
      json: { email: alice.email, password: alice.password },
    });
    await aliceClient.request("GET", "/api/me", { expectedStatus: 200 });

    logStep("Auth", "Creating second account with signup");
    const signupBob = await bobClient.request("POST", "/api/auth/signup", {
      expectedStatus: 201,
      json: {
        username: bob.username,
        email: bob.email,
        password: bob.password,
        accessCode: inviteCode,
      },
    });
    assert(signupBob.data?.user?.id, "Signup did not return bob user id.");
    const bobId = signupBob.data.user.id;

    logStep("Chat", "Creating conversation from first account to second account");
    const createConversation = await aliceClient.request("POST", "/api/conversations", {
      expectedStatus: [200, 201],
      json: { otherUserId: bobId },
    });
    const conversationId = createConversation.data?.conversationId;
    assert(conversationId, "Conversation creation did not return conversationId.");

    logStep("Chat", "Re-checking conversation dedupe");
    const createConversationAgain = await aliceClient.request("POST", "/api/conversations", {
      expectedStatus: 200,
      json: { username: bob.username },
    });
    assert(
      createConversationAgain.data?.conversationId === conversationId,
      "Duplicate conversation creation returned different conversationId.",
    );

    logStep("Chat", "Checking conversation lists for both users");
    const aliceConversations = await aliceClient.request("GET", "/api/conversations", {
      expectedStatus: 200,
    });
    assert(
      Array.isArray(aliceConversations.data?.conversations) &&
        aliceConversations.data.conversations.some((item) => item.id === conversationId),
      "Alice conversation list missing created conversation.",
    );

    const bobConversations = await bobClient.request("GET", "/api/conversations", {
      expectedStatus: 200,
    });
    assert(
      Array.isArray(bobConversations.data?.conversations) &&
        bobConversations.data.conversations.some((item) => item.id === conversationId),
      "Bob conversation list missing created conversation.",
    );

    logStep("Chat", "Sending messages through REST fallback endpoint");
    await aliceClient.request("POST", "/api/messages/send", {
      expectedStatus: 201,
      json: { conversationId, text: "Hello Bob from Alice #1" },
    });
    await aliceClient.request("POST", "/api/messages/send", {
      expectedStatus: 201,
      json: { conversationId, text: "Hello Bob from Alice #2" },
    });
    await bobClient.request("POST", "/api/messages/send", {
      expectedStatus: 201,
      json: { conversationId, text: "Hi Alice, Bob here." },
    });

    logStep("Chat", "Fetching messages and validating cursor pagination");
    const firstPage = await aliceClient.request(
      "GET",
      `/api/messages?conversationId=${encodeURIComponent(conversationId)}`,
      { expectedStatus: 200 },
    );

    assert(Array.isArray(firstPage.data?.messages), "Messages endpoint did not return array.");
    assert(firstPage.data.messages.length >= 3, "Expected at least 3 messages in first page.");

    const newestMessageId = firstPage.data.messages[0].id;
    assert(newestMessageId, "First page missing newest message id.");

    const cursorPage = await aliceClient.request(
      "GET",
      `/api/messages?conversationId=${encodeURIComponent(
        conversationId,
      )}&cursor=${encodeURIComponent(newestMessageId)}`,
      { expectedStatus: 200 },
    );
    assert(Array.isArray(cursorPage.data?.messages), "Cursor page did not return messages array.");
    assert(
      cursorPage.data.messages.length >= 1,
      "Cursor pagination should return at least one older message.",
    );

    logStep("Auth", "Testing logout/login flow for second account");
    await bobClient.request("POST", "/api/auth/logout", { expectedStatus: 200 });
    await bobClient.request("GET", "/api/me", { expectedStatus: 401 });
    await bobClient.request("POST", "/api/auth/login", {
      expectedStatus: 200,
      json: { email: bob.email, password: bob.password },
    });
    await bobClient.request("GET", "/api/me", { expectedStatus: 200 });

    console.log("\nAll required endpoints passed end-to-end checks.");
    console.log(`Users created: ${alice.email}, ${bob.email}`);
    console.log(`Conversation tested: ${conversationId}`);
  } finally {
    if (startedServer) {
      logStep("Cleanup", "Stopping local dev server started by script.");
      startedServer.kill("SIGTERM");
      await delay(500);
    }
  }
}

run().catch((error) => {
  console.error("\nAPI endpoint check failed:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
