export type DesktopNotificationPayload = {
  title: string;
  body?: string;
  conversationId?: string | null;
  messageId?: string | null;
};

export type DesktopDisplaySource = {
  id: string;
  name: string;
  kind: "screen" | "window";
  thumbnailDataUrl: string | null;
  appIconDataUrl: string | null;
};

export type DesktopScreenShareSelection = {
  sourceId: string;
  includeSystemAudio: boolean;
};

export type DesktopCallCapabilities = {
  platform: string;
  systemAudioSharingSupported: boolean;
};

export type DesktopBridge = {
  isDesktop: true;
  showNotification: (payload: DesktopNotificationPayload) => Promise<void>;
  setBadgeCount: (count: number) => Promise<void>;
  flashWindow: () => Promise<void>;
  stopFlashWindow: () => Promise<void>;
  listDisplaySources: () => Promise<DesktopDisplaySource[]>;
  prepareScreenShare: (selection: DesktopScreenShareSelection) => Promise<void>;
  getCallCapabilities: () => Promise<DesktopCallCapabilities>;
};

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

export function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.desktop ?? null;
}

export function isDesktopShell(): boolean {
  return getDesktopBridge()?.isDesktop === true;
}
