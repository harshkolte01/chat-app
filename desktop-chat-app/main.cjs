/* eslint-disable @typescript-eslint/no-require-imports */
if (process.env.ELECTRON_RUN_AS_NODE === "1") {
  console.error(
    "ELECTRON_RUN_AS_NODE=1 prevents Electron from starting normally. Use the desktop npm scripts, which clear it before launch.",
  );
  process.exit(1);
}

const { app, BrowserWindow, ipcMain, nativeImage, Notification, shell } = require("electron");
const path = require("node:path");
const { NEXT_APP_URL } = require("./next-app-url.cjs");

let mainWindow = null;
let unreadBadgeCount = 0;

function resolveAppUrl() {
  try {
    return new URL(NEXT_APP_URL).toString();
  } catch {
    return "http://127.0.0.1:3000";
  }
}

function normalizeBadgeCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return Math.max(0, Math.floor(parsed));
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }

  mainWindow.focus();
}

function createWindowsOverlayIcon(count) {
  const displayCount = count > 99 ? "99+" : String(count);
  const fontSize = displayCount.length >= 3 ? 24 : 30;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="30" fill="#b45309" />
      <text
        x="32"
        y="42"
        fill="#ffffff"
        font-family="Segoe UI, Arial, sans-serif"
        font-size="${fontSize}"
        font-weight="700"
        text-anchor="middle"
      >${displayCount}</text>
    </svg>
  `;

  return nativeImage
    .createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)
    .resize({ width: 32, height: 32 });
}

function applyBadgeCount(count) {
  unreadBadgeCount = normalizeBadgeCount(count);
  app.setBadgeCount(unreadBadgeCount);

  if (!mainWindow || mainWindow.isDestroyed() || process.platform !== "win32") {
    return;
  }

  if (unreadBadgeCount === 0) {
    mainWindow.setOverlayIcon(null, "");
    return;
  }

  mainWindow.setOverlayIcon(
    createWindowsOverlayIcon(unreadBadgeCount),
    `${unreadBadgeCount} unread messages`,
  );
}

function flashMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isFocused()) {
    return;
  }

  mainWindow.flashFrame(true);
}

function stopFlashingMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.flashFrame(false);
}

function registerDesktopIpc() {
  ipcMain.handle("desktop:show-notification", async (_event, payload) => {
    const title = typeof payload?.title === "string" ? payload.title.trim() : "";
    const body = typeof payload?.body === "string" ? payload.body.trim() : "";

    if (!title || !Notification.isSupported()) {
      return;
    }

    const notification = new Notification({
      title,
      body,
      silent: false,
    });

    notification.on("click", () => {
      focusMainWindow();
    });

    notification.show();
  });

  ipcMain.handle("desktop:set-badge-count", async (_event, count) => {
    applyBadgeCount(count);
  });

  ipcMain.handle("desktop:flash-window", async () => {
    flashMainWindow();
  });

  ipcMain.handle("desktop:stop-flash-window", async () => {
    stopFlashingMainWindow();
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f6f2e8",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("focus", () => {
    stopFlashingMainWindow();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  applyBadgeCount(unreadBadgeCount);
  void mainWindow.loadURL(resolveAppUrl());
}

void app
  .whenReady()
  .then(() => {
    if (process.platform === "win32") {
      app.setAppUserModelId("sec-chat.desktop");
    }

    registerDesktopIpc();
    createMainWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  })
  .catch((error) => {
    console.error("Electron startup failed:", error);
    app.exit(1);
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
