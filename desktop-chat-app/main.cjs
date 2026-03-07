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
const WINDOWS_BADGE_SIZE = 32;
const WINDOWS_BADGE_BACKGROUND = [180, 83, 9, 255];
const WINDOWS_BADGE_FOREGROUND = [255, 255, 255, 255];
const WINDOWS_BADGE_GLYPHS = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  "+": ["000", "010", "111", "010", "000"],
};

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

function setBitmapPixel(buffer, width, x, y, rgba) {
  if (x < 0 || y < 0 || x >= width) {
    return;
  }

  const height = buffer.length / (width * 4);
  if (y >= height) {
    return;
  }

  const offset = (y * width + x) * 4;
  buffer[offset] = rgba[0];
  buffer[offset + 1] = rgba[1];
  buffer[offset + 2] = rgba[2];
  buffer[offset + 3] = rgba[3];
}

function fillBadgeCircle(buffer, size, rgba) {
  const center = (size - 1) / 2;
  const radius = size / 2 - 1;
  const radiusSquared = radius * radius;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - center;
      const dy = y - center;
      if (dx * dx + dy * dy <= radiusSquared) {
        setBitmapPixel(buffer, size, x, y, rgba);
      }
    }
  }
}

function drawBadgeGlyph(buffer, size, glyph, left, top, pixelSize, rgba) {
  for (let rowIndex = 0; rowIndex < glyph.length; rowIndex += 1) {
    const row = glyph[rowIndex];
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      if (row[columnIndex] !== "1") {
        continue;
      }

      for (let pixelY = 0; pixelY < pixelSize; pixelY += 1) {
        for (let pixelX = 0; pixelX < pixelSize; pixelX += 1) {
          setBitmapPixel(
            buffer,
            size,
            left + columnIndex * pixelSize + pixelX,
            top + rowIndex * pixelSize + pixelY,
            rgba,
          );
        }
      }
    }
  }
}

function drawBadgeText(buffer, size, text, rgba) {
  const pixelSize = text.length >= 3 ? 2 : 3;
  const spacing = pixelSize;
  const glyphWidth = WINDOWS_BADGE_GLYPHS["0"][0].length * pixelSize;
  const glyphHeight = WINDOWS_BADGE_GLYPHS["0"].length * pixelSize;
  const totalWidth = text.length * glyphWidth + Math.max(0, text.length - 1) * spacing;
  const left = Math.floor((size - totalWidth) / 2);
  const top = Math.floor((size - glyphHeight) / 2);

  for (let index = 0; index < text.length; index += 1) {
    const glyph = WINDOWS_BADGE_GLYPHS[text[index]];
    if (!glyph) {
      continue;
    }

    drawBadgeGlyph(
      buffer,
      size,
      glyph,
      left + index * (glyphWidth + spacing),
      top,
      pixelSize,
      rgba,
    );
  }
}

function createWindowsOverlayIcon(count) {
  const displayCount = count > 99 ? "99+" : String(count);
  const bitmap = Buffer.alloc(WINDOWS_BADGE_SIZE * WINDOWS_BADGE_SIZE * 4, 0);
  fillBadgeCircle(bitmap, WINDOWS_BADGE_SIZE, WINDOWS_BADGE_BACKGROUND);
  drawBadgeText(bitmap, WINDOWS_BADGE_SIZE, displayCount, WINDOWS_BADGE_FOREGROUND);

  return nativeImage.createFromBitmap(bitmap, {
    width: WINDOWS_BADGE_SIZE,
    height: WINDOWS_BADGE_SIZE,
  });
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
    applyBadgeCount(unreadBadgeCount);
  });

  mainWindow.on("focus", () => {
    stopFlashingMainWindow();
  });

  mainWindow.on("show", () => {
    applyBadgeCount(unreadBadgeCount);
  });

  mainWindow.on("restore", () => {
    applyBadgeCount(unreadBadgeCount);
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
