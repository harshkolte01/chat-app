export type DesktopNotificationPayload = {
  title: string;
  body?: string;
  conversationId?: string | null;
  messageId?: string | null;
};

export type DesktopBridge = {
  isDesktop: true;
  showNotification: (payload: DesktopNotificationPayload) => Promise<void>;
  setBadgeCount: (count: number) => Promise<void>;
  flashWindow: () => Promise<void>;
  stopFlashWindow: () => Promise<void>;
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
