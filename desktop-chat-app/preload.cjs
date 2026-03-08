/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  isDesktop: true,
  showNotification: (payload) => ipcRenderer.invoke("desktop:show-notification", payload),
  setBadgeCount: (count) => ipcRenderer.invoke("desktop:set-badge-count", count),
  flashWindow: () => ipcRenderer.invoke("desktop:flash-window"),
  stopFlashWindow: () => ipcRenderer.invoke("desktop:stop-flash-window"),
  listDisplaySources: () => ipcRenderer.invoke("desktop:list-display-sources"),
  prepareScreenShare: (selection) => ipcRenderer.invoke("desktop:prepare-screen-share", selection),
  getCallCapabilities: () => ipcRenderer.invoke("desktop:get-call-capabilities"),
});
