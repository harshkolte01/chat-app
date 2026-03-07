/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  isDesktop: true,
  showNotification: (payload) => ipcRenderer.invoke("desktop:show-notification", payload),
  setBadgeCount: (count) => ipcRenderer.invoke("desktop:set-badge-count", count),
  flashWindow: () => ipcRenderer.invoke("desktop:flash-window"),
  stopFlashWindow: () => ipcRenderer.invoke("desktop:stop-flash-window"),
});
