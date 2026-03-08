"use client";

import {
  ChangeEvent,
  FormEvent,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { io, Socket } from "socket.io-client";
import { PublicUser } from "@/lib/auth/current-user";
import {
  appendPinUnlockQuery,
  clearStoredPinUnlockToken,
  dispatchPinLock,
  isPinAccessErrorCode,
  getStoredPinUnlockToken,
  withPinProtectedRequestInit,
} from "@/lib/auth/pin-client";
import { BrandMark } from "@/components/BrandMark";
import { CallOverlay } from "@/components/chat/CallOverlay";
import { Composer } from "@/components/chat/Composer";
import { useDesktopCallController } from "@/components/chat/useDesktopCallController";
import { getDesktopBridge, isDesktopShell } from "@/lib/desktop-bridge";
import { getRealtimeServerUrl, getRealtimeSocketPath } from "@/lib/realtime/config";
import {
  isRealtimeTokenRefreshErrorCode,
  RealtimeTokenResponse,
} from "@/lib/realtime/contracts";
import {
  ChatMessageStatusUpdatedEvent,
  ChatNewMessageEvent,
  ClientToServerEvents,
  MessageReadPayload,
  SendMessageAckData,
  ServerToClientEvents,
  SocketAckResponse,
  SocketMessage,
  SocketPublicUser,
} from "@/lib/socket/contracts";

type Conversation = {
  id: string;
  otherUser: PublicUser;
  lastActivityAt: string;
  lastMessage: {
    id: string;
    senderId: string;
    type: "TEXT" | "IMAGE";
    status: "SENT" | "DELIVERED" | "READ";
    textPreview: string;
    createdAt: string;
  } | null;
  unreadCount: number;
  latestUnreadMessage: ConversationUnreadMessage | null;
};

type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  sender: PublicUser;
  type: "TEXT" | "IMAGE";
  text: string | null;
  imageKey: string | null;
  replyTo: MessageReply | null;
  status: "SENT" | "DELIVERED" | "READ";
  createdAt: string;
};

type MessageReply = {
  id: string;
  senderId: string;
  senderUsername: string;
  type: "TEXT" | "IMAGE";
  text: string | null;
  imageKey: string | null;
  createdAt: string;
};

type ConversationUnreadMessage = {
  id: string;
  senderId: string;
  senderUsername: string;
  type: "TEXT" | "IMAGE";
  textPreview: string;
  createdAt: string;
};

type ConversationsResponse = {
  conversations: Conversation[];
};

type MessagesResponse = {
  messages: Message[];
  nextCursor: string | null;
};

type SendMessageResponse = {
  message: Omit<Message, "sender">;
  sender: PublicUser;
};

type UsersResponse = {
  users: PublicUser[];
};

type CreateConversationResponse = {
  conversationId: string;
  created: boolean;
};

type ReadMessagesResponse = {
  updatedCount: number;
  readAt: string;
};

type UpdateProfileResponse = {
  user: PublicUser;
};

type PresignUploadResponse = {
  uploadUrl: string;
  fileUrl: string;
  objectKey: string;
  expiresIn: number;
  public: boolean;
};

type RelayUploadResponse = {
  fileUrl: string;
  objectKey: string;
  public: boolean;
  uploadedVia: "relay";
};

type CameraFacingMode = "user" | "environment";

type SocketClient = Socket<ServerToClientEvents, ClientToServerEvents>;

type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
  };
};

const SOCKET_ACK_TIMEOUT_MS = 8_000;
const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const POLL_MESSAGES_INTERVAL_MS = 2_500;
const POLL_CONVERSATIONS_INTERVAL_MS = 5_000;
const POLL_BACKOFF_MAX_MS = 60_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,32}$/;
const MIN_PASSWORD_LENGTH = 8;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function safeDecodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function encodeObjectKeyForProxy(objectKey: string): string {
  return objectKey
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function extractObjectKeyFromPathname(pathname: string): string | null {
  const pathSegments = pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => safeDecodeSegment(segment));
  const objectStart = pathSegments.findIndex((segment) => segment === "chat-images");
  if (objectStart < 0) {
    return null;
  }

  return pathSegments.slice(objectStart).join("/");
}

function normalizeMessageImageUrl(imageKey: string): string {
  const trimmed = imageKey.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (trimmed.startsWith("/api/uploads/object/")) {
    return appendPinUnlockQuery(trimmed);
  }

  if (trimmed.startsWith("chat-images/")) {
    return appendPinUnlockQuery(`/api/uploads/object/${encodeObjectKeyForProxy(trimmed)}`);
  }

  if (trimmed.startsWith("/")) {
    const objectKey = extractObjectKeyFromPathname(trimmed);
    if (objectKey) {
      return appendPinUnlockQuery(`/api/uploads/object/${encodeObjectKeyForProxy(objectKey)}`);
    }
    return trimmed;
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const parsed = new URL(trimmed);

      if (parsed.pathname.startsWith("/api/uploads/object/")) {
        return appendPinUnlockQuery(parsed.pathname);
      }

      const objectKey = extractObjectKeyFromPathname(parsed.pathname);
      if (objectKey) {
        return appendPinUnlockQuery(`/api/uploads/object/${encodeObjectKeyForProxy(objectKey)}`);
      }
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

function shouldUseUploadRelay(uploadUrl: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return window.location.protocol === "https:" && uploadUrl.startsWith("http://");
}

function sortMessagesNewestFirst(messages: Message[]): Message[] {
  return [...messages].sort((left, right) => {
    const timeDiff = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    if (timeDiff !== 0) {
      return timeDiff;
    }

    return right.id.localeCompare(left.id);
  });
}

function mergeLatestMessages(previous: Message[], latest: Message[]): Message[] {
  if (previous.length === 0) {
    return latest;
  }

  const byId = new Map<string, Message>();
  for (const message of previous) {
    byId.set(message.id, message);
  }
  for (const message of latest) {
    byId.set(message.id, message);
  }

  return sortMessagesNewestFirst([...byId.values()]);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, withPinProtectedRequestInit(init));
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const errorCode = (payload as ApiErrorPayload | null)?.error?.code ?? null;
    if (isPinAccessErrorCode(errorCode)) {
      clearStoredPinUnlockToken();
      dispatchPinLock();
    }

    const errorMessage = (payload as ApiErrorPayload | null)?.error?.message ?? "Request failed.";
    throw new Error(errorMessage);
  }

  return payload as T;
}

async function fetchRealtimeToken(): Promise<RealtimeTokenResponse> {
  return fetchJson<RealtimeTokenResponse>("/api/realtime/token", {
    method: "POST",
    cache: "no-store",
  });
}

function syncMessagesWithProfileUpdate(previous: Message[], nextUser: PublicUser): Message[] {
  return previous.map((message) => {
    const sender = message.senderId === nextUser.id ? nextUser : message.sender;
    const replyTo =
      message.replyTo && message.replyTo.senderId === nextUser.id
        ? {
            ...message.replyTo,
            senderUsername: nextUser.username,
          }
        : message.replyTo;

    if (sender === message.sender && replyTo === message.replyTo) {
      return message;
    }

    return {
      ...message,
      sender,
      replyTo,
    };
  });
}

function formatJoinedDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatConversationTimestamp(value: string): string {
  const timestamp = new Date(value);
  const now = new Date();

  if (timestamp.toDateString() === now.toDateString()) {
    return timestamp.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (timestamp.toDateString() === yesterday.toDateString()) {
    return "Yesterday";
  }

  if (timestamp.getFullYear() === now.getFullYear()) {
    return timestamp.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
    });
  }

  return timestamp.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function getUserInitials(username: string): string {
  const parts = username
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) {
    return "U";
  }

  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("").slice(0, 2);
}

function conversationPreviewText(conversation: Conversation, currentUserId: string): string {
  const lastMessage = conversation.lastMessage;
  if (!lastMessage) {
    return "No messages yet";
  }

  const prefix = lastMessage.senderId === currentUserId ? "You: " : "";
  return `${prefix}${lastMessage.textPreview}`;
}

function SettingsIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 3.75v1.5" />
      <path d="M18.54 5.46l-1.06 1.06" />
      <path d="M20.25 12h-1.5" />
      <path d="M18.54 18.54l-1.06-1.06" />
      <path d="M12 18.75v1.5" />
      <path d="M6.52 17.48l-1.06 1.06" />
      <path d="M5.25 12h-1.5" />
      <path d="M6.52 6.52L5.46 5.46" />
      <circle cx="12" cy="12" r="3.25" />
      <circle cx="12" cy="12" r="7.25" />
    </svg>
  );
}

function toPublicUser(user: SocketPublicUser): PublicUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    createdAt: user.createdAt,
  };
}

function toMessageFromSocket(payload: ChatNewMessageEvent): Message {
  return {
    id: payload.message.id,
    conversationId: payload.message.conversationId,
    senderId: payload.message.senderId,
    sender: toPublicUser(payload.sender),
    type: payload.message.type,
    text: payload.message.text,
    imageKey: payload.message.imageKey,
    replyTo: payload.message.replyTo,
    status: payload.message.status,
    createdAt: payload.message.createdAt,
  };
}

function toMessageFromSendResponse(response: SendMessageResponse): Message {
  return {
    id: response.message.id,
    conversationId: response.message.conversationId,
    senderId: response.message.senderId,
    sender: response.sender,
    type: response.message.type,
    text: response.message.text,
    imageKey: response.message.imageKey,
    replyTo: response.message.replyTo,
    status: response.message.status,
    createdAt: response.message.createdAt,
  };
}

function toMessageFromSocketAck(data: SendMessageAckData): Message {
  return {
    id: data.message.id,
    conversationId: data.message.conversationId,
    senderId: data.message.senderId,
    sender: toPublicUser(data.sender),
    type: data.message.type,
    text: data.message.text,
    imageKey: data.message.imageKey,
    replyTo: data.message.replyTo,
    status: data.message.status,
    createdAt: data.message.createdAt,
  };
}

function messagePreview(message: SocketMessage | Message): string {
  if (message.type === "TEXT") {
    return message.text ?? "";
  }
  return "[image]";
}

function messageReplyPreview(replyTo: MessageReply): string {
  if (replyTo.type === "TEXT") {
    return replyTo.text?.trim() || "[message]";
  }
  return "[image]";
}

function toReplyTarget(message: Message): MessageReply {
  return {
    id: message.id,
    senderId: message.senderId,
    senderUsername: message.sender.username,
    type: message.type,
    text: message.text,
    imageKey: message.imageKey,
    createdAt: message.createdAt,
  };
}

function toConversationUnreadMessage(
  message: SocketMessage | Message,
  senderUsername: string,
): ConversationUnreadMessage {
  return {
    id: message.id,
    senderId: message.senderId,
    senderUsername,
    type: message.type,
    textPreview: messagePreview(message),
    createdAt: message.createdAt,
  };
}

function updateConversationPreview(
  previous: Conversation[],
  message: SocketMessage | Message,
  options: {
    unreadDelta?: number;
    latestUnreadMessage?: ConversationUnreadMessage | null;
  } = {},
): Conversation[] {
  const targetIndex = previous.findIndex(
    (conversation) => conversation.id === message.conversationId,
  );

  if (targetIndex < 0) {
    return previous;
  }

  const target = previous[targetIndex];
  if (target.lastMessage?.id === message.id) {
    return previous;
  }

  const updatedConversation: Conversation = {
    ...target,
    lastActivityAt: message.createdAt,
    lastMessage: {
      id: message.id,
      senderId: message.senderId,
      type: message.type,
      status: message.status,
      textPreview: messagePreview(message),
      createdAt: message.createdAt,
    },
    unreadCount: Math.max(0, target.unreadCount + (options.unreadDelta ?? 0)),
    latestUnreadMessage:
      options.latestUnreadMessage === undefined
        ? target.latestUnreadMessage
        : options.latestUnreadMessage,
  };

  const next = previous.filter((_, index) => index !== targetIndex);
  return [updatedConversation, ...next];
}

function clearConversationUnreadState(
  previous: Conversation[],
  conversationId: string,
  currentUserId: string,
  readAt: string,
) {
  return previous.map((conversation) => {
    if (conversation.id !== conversationId) {
      return conversation;
    }

    const lastMessage =
      conversation.lastMessage &&
      conversation.lastMessage.senderId !== currentUserId &&
      conversation.lastMessage.createdAt <= readAt &&
      conversation.lastMessage.status !== "READ"
        ? {
            ...conversation.lastMessage,
            status: "READ" as const,
          }
        : conversation.lastMessage;

    return {
      ...conversation,
      lastMessage,
      unreadCount: 0,
      latestUnreadMessage: null,
    };
  });
}

function markMessagesReadLocally(
  previous: Message[],
  conversationId: string,
  currentUserId: string,
  readAt: string,
) {
  return previous.map((message) => {
    if (
      message.conversationId !== conversationId ||
      message.senderId === currentUserId ||
      message.createdAt > readAt ||
      message.status === "READ"
    ) {
      return message;
    }

    return {
      ...message,
      status: "READ" as const,
    };
  });
}

function updateMessageStatusLocally(previous: Message[], payload: ChatMessageStatusUpdatedEvent) {
  return previous.map((message) =>
    message.id === payload.messageId ? { ...message, status: payload.status } : message,
  );
}

function updateConversationStatusLocally(
  previous: Conversation[],
  payload: ChatMessageStatusUpdatedEvent,
) {
  return previous.map((conversation) => {
    if (conversation.id !== payload.conversationId || !conversation.lastMessage) {
      return conversation;
    }

    if (conversation.lastMessage.id !== payload.messageId) {
      return conversation;
    }

    return {
      ...conversation,
      lastMessage: {
        ...conversation.lastMessage,
        status: payload.status,
      },
    };
  });
}

function emitSendMessageWithAck(
  socket: SocketClient,
  payload: {
    conversationId: string;
    type: "text" | "image";
    text?: string;
    imageKey?: string;
    replyToMessageId?: string;
    clientMessageId: string;
  },
) {
  return new Promise<SocketAckResponse<SendMessageAckData>>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        ok: false,
        error: {
          code: "ACK_TIMEOUT",
          message: "Socket ack timeout.",
        },
      });
    }, SOCKET_ACK_TIMEOUT_MS);

    socket.emit("chat:send_message", payload, (response) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve(response);
    });
  });
}

function emitReadMessageWithAck(socket: SocketClient, payload: MessageReadPayload) {
  return new Promise<SocketAckResponse<{ updatedCount: number }>>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      resolve({
        ok: false,
        error: {
          code: "ACK_TIMEOUT",
          message: "Socket ack timeout.",
        },
      });
    }, SOCKET_ACK_TIMEOUT_MS);

    socket.emit("chat:message_read", payload, (response) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve(response);
    });
  });
}

export function ChatClient({ currentUser: initialCurrentUser }: { currentUser: PublicUser }) {
  const router = useRouter();
  const socketRef = useRef<SocketClient | null>(null);
  const selectedConversationIdRef = useRef<string | null>(null);
  const allowAutoSelectConversationRef = useRef(true);
  const lastReadEventRef = useRef<string | null>(null);
  const hasInitializedUnreadTrackingRef = useRef(false);
  const observedUnreadMessageIdsRef = useRef<Map<string, string>>(new Map());
  const messageScrollRef = useRef<HTMLDivElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  const [accountUser, setAccountUser] = useState(initialCurrentUser);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [replyingTo, setReplyingTo] = useState<MessageReply | null>(null);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraFacingMode, setCameraFacingMode] = useState<CameraFacingMode>("environment");
  const [messagePanelFullscreen, setMessagePanelFullscreen] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [socketInstance, setSocketInstance] = useState<SocketClient | null>(null);
  const [directoryQuery, setDirectoryQuery] = useState("");
  const [directorySearchResult, setDirectorySearchResult] = useState<PublicUser | null>(null);
  const [directorySearchMessage, setDirectorySearchMessage] = useState<string | null>(null);
  const [searchingDirectoryUser, setSearchingDirectoryUser] = useState(false);
  const [creatingConversation, setCreatingConversation] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileUsername, setProfileUsername] = useState(initialCurrentUser.username);
  const [profileEmail, setProfileEmail] = useState(initialCurrentUser.email);
  const [profileCurrentPassword, setProfileCurrentPassword] = useState("");
  const [profileNewPassword, setProfileNewPassword] = useState("");
  const [profileConfirmPassword, setProfileConfirmPassword] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPageVisible, setIsPageVisible] = useState(
    () => (typeof document === "undefined" ? true : document.visibilityState === "visible"),
  );
  const [isBrowserOnline, setIsBrowserOnline] = useState(
    () => (typeof navigator === "undefined" ? true : navigator.onLine),
  );
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const desktopShell = isDesktopShell();
  const realtimeServerUrl = getRealtimeServerUrl();
  const realtimeSocketPath = getRealtimeSocketPath();

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId],
  );
  const displayedMessages = useMemo(() => [...messages].reverse(), [messages]);
  const newestMessageId = messages[0]?.id ?? null;
  const totalUnreadCount = useMemo(
    () => conversations.reduce((sum, conversation) => sum + conversation.unreadCount, 0),
    [conversations],
  );
  const realtimeStatus = socketConnected
    ? "connected"
    : isBrowserOnline
      ? desktopShell || isPageVisible
        ? "polling fallback active"
        : "paused (tab hidden)"
      : "offline";
  const callController = useDesktopCallController({
    currentUser: accountUser,
    selectedConversation,
    socket: socketInstance,
    socketConnected,
    desktopShell,
  });
  const memberSinceLabel = formatJoinedDate(accountUser.createdAt);
  const normalizedProfileEmail = normalizeEmail(profileEmail);
  const profileHasChanges =
    profileUsername.trim() !== accountUser.username ||
    normalizedProfileEmail !== accountUser.email ||
    profileCurrentPassword.length > 0 ||
    profileNewPassword.length > 0 ||
    profileConfirmPassword.length > 0;

  const selectConversation = useCallback((conversationId: string) => {
    allowAutoSelectConversationRef.current = true;
    setSelectedConversationId(conversationId);
  }, []);

  const closeConversation = useCallback(() => {
    allowAutoSelectConversationRef.current = false;
    setSelectedConversationId(null);
    setMessages([]);
    setNextCursor(null);
    setMessagePanelFullscreen(false);
  }, []);

  const openProfilePanel = useCallback(() => {
    setProfileUsername(accountUser.username);
    setProfileEmail(accountUser.email);
    setProfileCurrentPassword("");
    setProfileNewPassword("");
    setProfileConfirmPassword("");
    setProfileError(null);
    setProfileSuccess(null);
    setProfileOpen(true);
  }, [accountUser.email, accountUser.username]);

  const closeProfilePanel = useCallback(() => {
    if (savingProfile) {
      return;
    }

    setProfileOpen(false);
    setProfileCurrentPassword("");
    setProfileNewPassword("");
    setProfileConfirmPassword("");
    setProfileError(null);
    setProfileSuccess(null);
  }, [savingProfile]);

  const showDesktopNotification = useCallback((params: {
    conversationId: string;
    latestUnreadMessage: ConversationUnreadMessage;
  }) => {
    const desktop = getDesktopBridge();
    if (!desktop) {
      return;
    }

    void desktop.showNotification({
      title: params.latestUnreadMessage.senderUsername,
      body: params.latestUnreadMessage.textPreview,
      conversationId: params.conversationId,
      messageId: params.latestUnreadMessage.id,
    });
    void desktop.flashWindow();
  }, []);

  const isConversationActivelyViewed = useCallback((conversationId: string) => {
    if (selectedConversationIdRef.current !== conversationId || typeof document === "undefined") {
      return false;
    }

    return document.visibilityState === "visible" && document.hasFocus();
  }, []);

  const syncObservedUnreadMessages = useCallback(
    (nextConversations: Conversation[]) => {
      const observedUnreadMessageIds = observedUnreadMessageIdsRef.current;
      const nextConversationIds = new Set<string>();

      if (!hasInitializedUnreadTrackingRef.current) {
        observedUnreadMessageIds.clear();
        for (const conversation of nextConversations) {
          nextConversationIds.add(conversation.id);
          if (conversation.latestUnreadMessage) {
            observedUnreadMessageIds.set(conversation.id, conversation.latestUnreadMessage.id);
          }
        }

        hasInitializedUnreadTrackingRef.current = true;
        return;
      }

      for (const conversation of nextConversations) {
        nextConversationIds.add(conversation.id);

        const latestUnreadMessage = conversation.latestUnreadMessage;
        if (!latestUnreadMessage) {
          observedUnreadMessageIds.delete(conversation.id);
          continue;
        }

        const previouslyObservedId = observedUnreadMessageIds.get(conversation.id);
        if (previouslyObservedId === latestUnreadMessage.id) {
          continue;
        }

        observedUnreadMessageIds.set(conversation.id, latestUnreadMessage.id);
        if (!desktopShell || isConversationActivelyViewed(conversation.id)) {
          continue;
        }

        showDesktopNotification({
          conversationId: conversation.id,
          latestUnreadMessage,
        });
      }

      for (const conversationId of [...observedUnreadMessageIds.keys()]) {
        if (!nextConversationIds.has(conversationId)) {
          observedUnreadMessageIds.delete(conversationId);
        }
      }
    },
    [desktopShell, isConversationActivelyViewed, showDesktopNotification],
  );

  const loadConversations = useCallback(async (options: { silent?: boolean } = {}) => {
    const silent = options.silent === true;
    if (!silent) {
      setLoadingConversations(true);
      setError(null);
    }

    try {
      const data = await fetchJson<ConversationsResponse>("/api/conversations");
      syncObservedUnreadMessages(data.conversations);
      setConversations(data.conversations);

      setSelectedConversationId((previousSelectedConversationId) => {
        if (data.conversations.length === 0) {
          setMessages([]);
          setNextCursor(null);
          return null;
        }

        if (!previousSelectedConversationId) {
          return allowAutoSelectConversationRef.current ? data.conversations[0].id : null;
        }

        const selectedStillExists = data.conversations.some(
          (conversation) => conversation.id === previousSelectedConversationId,
        );

        if (selectedStillExists) {
          return previousSelectedConversationId;
        }

        return allowAutoSelectConversationRef.current ? data.conversations[0].id : null;
      });
      return data.conversations;
    } catch (loadError) {
      if (silent) {
        throw loadError;
      }
      setError(loadError instanceof Error ? loadError.message : "Failed to load conversations.");
      return [];
    } finally {
      if (!silent) {
        setLoadingConversations(false);
      }
    }
  }, [syncObservedUnreadMessages]);

  const searchDirectoryUserByEmail = useCallback(async (email: string) => {
    setSearchingDirectoryUser(true);
    setDirectorySearchResult(null);
    setDirectorySearchMessage(null);

    try {
      const params = new URLSearchParams({ email });
      const data = await fetchJson<UsersResponse>(`/api/users?${params.toString()}`);
      const matchedUser = data.users[0] ?? null;

      if (!matchedUser) {
        setDirectorySearchMessage("No user found for that email.");
        return null;
      }

      setDirectorySearchResult(matchedUser);
      return matchedUser;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load users.");
      return null;
    } finally {
      setSearchingDirectoryUser(false);
    }
  }, []);

  const loadMessages = useCallback(
    async (
      conversationId: string,
      cursor: string | null = null,
      options: { silent?: boolean } = {},
    ) => {
      const silent = options.silent === true;
      if (!silent) {
        setLoadingMessages(true);
        setError(null);
      }

      try {
        const query = new URLSearchParams({ conversationId });
        if (cursor) {
          query.set("cursor", cursor);
        }

        const data = await fetchJson<MessagesResponse>(`/api/messages?${query.toString()}`);
        setMessages((previous) => {
          if (cursor) {
            return [...previous, ...data.messages];
          }

          if (silent) {
            return mergeLatestMessages(previous, data.messages);
          }

          return data.messages;
        });
        setNextCursor(data.nextCursor);
        return data.messages;
      } catch (loadError) {
        if (silent) {
          throw loadError;
        }
        setError(loadError instanceof Error ? loadError.message : "Failed to load messages.");
        return [];
      } finally {
        if (!silent) {
          setLoadingMessages(false);
        }
      }
    },
    [],
  );

  const markConversationRead = useCallback(async (payload: MessageReadPayload) => {
    const socket = socketRef.current;
    if (socket && socket.connected) {
      const ack = await emitReadMessageWithAck(socket, payload);
      if (!ack.ok) {
        throw new Error(ack.error.message);
      }

      return;
    }

    await fetchJson<ReadMessagesResponse>("/api/messages/read", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  }, []);

  async function sendViaRestFallback(payload: {
    conversationId: string;
    text?: string;
    imageUrl?: string;
    replyToMessageId?: string;
  }) {
    const response = await fetchJson<SendMessageResponse>("/api/messages/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    return toMessageFromSendResponse(response);
  }

  async function onSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const conversationId = selectedConversationId;
    const text = draft.trim();
    if (!conversationId || !text || sendingMessage) {
      return;
    }

    const activeReplyTo =
      replyingTo && replyingTo.id && conversationId ? replyingTo : null;

    setSendingMessage(true);
    setError(null);
    setDraft("");

    const clientMessageId = `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const optimisticMessage: Message = {
      id: clientMessageId,
      conversationId,
      senderId: accountUser.id,
      sender: accountUser,
      type: "TEXT",
      text,
      imageKey: null,
      replyTo: activeReplyTo,
      status: "SENT",
      createdAt: new Date().toISOString(),
    };

    setMessages((previous) => [optimisticMessage, ...previous]);
    setConversations((previous) => updateConversationPreview(previous, optimisticMessage));

    try {
      const socket = socketRef.current;
      let storedMessage: Message;

      if (socket && socket.connected) {
        const ack = await emitSendMessageWithAck(socket, {
          conversationId,
          type: "text",
          text,
          replyToMessageId: activeReplyTo?.id,
          clientMessageId,
        });

        if (ack.ok && ack.data) {
          storedMessage = toMessageFromSocketAck(ack.data);
        } else {
          storedMessage = await sendViaRestFallback({
            conversationId,
            text,
            replyToMessageId: activeReplyTo?.id,
          });
        }
      } else {
        storedMessage = await sendViaRestFallback({
          conversationId,
          text,
          replyToMessageId: activeReplyTo?.id,
        });
      }

      setMessages((previous) =>
        previous.map((message) => (message.id === clientMessageId ? storedMessage : message)),
      );
      setConversations((previous) => updateConversationPreview(previous, storedMessage));
      setReplyingTo(null);
    } catch (sendError) {
      setMessages((previous) => previous.filter((message) => message.id !== clientMessageId));
      setDraft(text);
      setReplyingTo(activeReplyTo);
      setError(sendError instanceof Error ? sendError.message : "Failed to send message.");
    } finally {
      setSendingMessage(false);
    }
  }

  async function uploadImageToObjectStore(file: File, contentType: string): Promise<string> {
    async function uploadViaRelay(): Promise<string> {
      const formData = new FormData();
      formData.set("file", file, file.name || `upload-${Date.now()}.jpg`);

      const response = await fetch(
        "/api/uploads/relay",
        withPinProtectedRequestInit({
          method: "POST",
          body: formData,
        }),
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const errorCode = (payload as ApiErrorPayload | null)?.error?.code ?? null;
        if (isPinAccessErrorCode(errorCode)) {
          clearStoredPinUnlockToken();
          dispatchPinLock();
        }

        const message =
          (payload as ApiErrorPayload | null)?.error?.message ?? "Image upload failed.";
        throw new Error(message);
      }

      return (payload as RelayUploadResponse).fileUrl;
    }

    const presign = await fetchJson<PresignUploadResponse>("/api/uploads/presign", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filename: file.name,
        contentType,
      }),
    });

    if (shouldUseUploadRelay(presign.uploadUrl)) {
      return uploadViaRelay();
    }

    try {
      const uploadResponse = await fetch(presign.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": contentType,
        },
        body: file,
      });

      if (!uploadResponse.ok) {
        throw new Error("Image upload failed.");
      }

      return presign.fileUrl;
    } catch {
      if (presign.uploadUrl.startsWith("http://")) {
        return uploadViaRelay();
      }

      throw new Error("Image upload failed.");
    }
  }

  async function sendImageMessage(
    conversationId: string,
    imageUrl: string,
    replyTo: MessageReply | null,
  ) {
    const clientMessageId = `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const optimisticMessage: Message = {
      id: clientMessageId,
      conversationId,
      senderId: accountUser.id,
      sender: accountUser,
      type: "IMAGE",
      text: null,
      imageKey: imageUrl,
      replyTo,
      status: "SENT",
      createdAt: new Date().toISOString(),
    };

    setMessages((previous) => [optimisticMessage, ...previous]);
    setConversations((previous) => updateConversationPreview(previous, optimisticMessage));

    try {
      const socket = socketRef.current;
      let storedMessage: Message;

      if (socket && socket.connected) {
        const ack = await emitSendMessageWithAck(socket, {
          conversationId,
          type: "image",
          imageKey: imageUrl,
          replyToMessageId: replyTo?.id,
          clientMessageId,
        });

        if (ack.ok && ack.data) {
          storedMessage = toMessageFromSocketAck(ack.data);
        } else {
          storedMessage = await sendViaRestFallback({
            conversationId,
            imageUrl,
            replyToMessageId: replyTo?.id,
          });
        }
      } else {
        storedMessage = await sendViaRestFallback({
          conversationId,
          imageUrl,
          replyToMessageId: replyTo?.id,
        });
      }

      setMessages((previous) =>
        previous.map((message) => (message.id === clientMessageId ? storedMessage : message)),
      );
      setConversations((previous) => updateConversationPreview(previous, storedMessage));
    } catch (sendError) {
      setMessages((previous) => previous.filter((message) => message.id !== clientMessageId));
      throw sendError;
    }
  }

  async function processImageFile(file: File) {
    const conversationId = selectedConversationId;
    if (!file || !conversationId || uploadingImage || sendingMessage) {
      return;
    }
    const activeReplyTo = replyingTo;

    const contentType = file.type?.trim() || "image/jpeg";
    if (!contentType.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }

    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      setError("Image must be smaller than 10 MB.");
      return;
    }

    setUploadingImage(true);
    setError(null);

    try {
      const imageUrl = await uploadImageToObjectStore(file, contentType);
      await sendImageMessage(conversationId, imageUrl, activeReplyTo);
      setReplyingTo(null);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Failed to upload image.");
    } finally {
      setUploadingImage(false);
    }
  }

  function stopCameraStream() {
    if (cameraStreamRef.current) {
      for (const track of cameraStreamRef.current.getTracks()) {
        track.stop();
      }
      cameraStreamRef.current = null;
    }

    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null;
    }
  }

  function closeCameraModal() {
    stopCameraStream();
    setCameraOpen(false);
  }

  async function openCameraModal(preferredFacingMode: CameraFacingMode = cameraFacingMode) {
    if (!selectedConversationId || uploadingImage || sendingMessage || cameraStarting) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera is not supported in this browser.");
      return;
    }

    setCameraStarting(true);
    setError(null);
    stopCameraStream();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: preferredFacingMode },
        },
        audio: false,
      });

      cameraStreamRef.current = stream;
      setCameraFacingMode(preferredFacingMode);
      setCameraOpen(true);

      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream;
        await cameraVideoRef.current.play().catch(() => undefined);
      }
    } catch (cameraError) {
      setCameraOpen(false);
      stopCameraStream();

      if (cameraError instanceof DOMException && cameraError.name === "NotAllowedError") {
        setError("Camera permission denied. Please allow camera access.");
        return;
      }

      if (cameraError instanceof DOMException && cameraError.name === "NotFoundError") {
        setError("No camera device found.");
        return;
      }

      setError("Unable to access camera.");
    } finally {
      setCameraStarting(false);
    }
  }

  async function switchCameraFacingMode() {
    const nextFacingMode: CameraFacingMode = cameraFacingMode === "environment" ? "user" : "environment";
    await openCameraModal(nextFacingMode);
  }

  async function captureFromCamera() {
    const video = cameraVideoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      setError("Camera is not ready yet. Please try again.");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setError("Unable to capture image from camera.");
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.92);
    });

    if (!blob) {
      setError("Unable to capture image from camera.");
      return;
    }

    const capturedFile = new File([blob], `camera-${Date.now()}.jpg`, {
      type: "image/jpeg",
    });

    closeCameraModal();
    await processImageFile(capturedFile);
  }

  async function onImageSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    await processImageFile(file);
  }

  async function onSearchDirectoryUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (searchingDirectoryUser || creatingConversation) {
      return;
    }

    setError(null);
    const normalizedEmail = normalizeEmail(directoryQuery);
    if (!normalizedEmail || !EMAIL_PATTERN.test(normalizedEmail)) {
      setDirectorySearchResult(null);
      setDirectorySearchMessage("Enter a valid email address.");
      return;
    }

    setDirectoryQuery(normalizedEmail);
    await searchDirectoryUserByEmail(normalizedEmail);
  }

  async function onStartConversation() {
    if (!directorySearchResult || creatingConversation || searchingDirectoryUser) {
      return;
    }

    setCreatingConversation(true);
    setError(null);

    try {
      const response = await fetchJson<CreateConversationResponse>("/api/conversations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          otherUserId: directorySearchResult.id,
        }),
      });

      await loadConversations();
      allowAutoSelectConversationRef.current = true;
      setSelectedConversationId(response.conversationId);
      setMessages([]);
      setNextCursor(null);
      setDirectoryQuery("");
      setDirectorySearchResult(null);
      setDirectorySearchMessage(null);
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "Failed to start conversation.",
      );
    } finally {
      setCreatingConversation(false);
    }
  }

  async function onSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingProfile) {
      return;
    }

    const nextUsername = profileUsername.trim();
    const nextEmail = normalizeEmail(profileEmail);
    const currentPassword = profileCurrentPassword;
    const newPassword = profileNewPassword;
    const confirmPassword = profileConfirmPassword;
    const passwordFieldsTouched =
      currentPassword.length > 0 || newPassword.length > 0 || confirmPassword.length > 0;

    setProfileError(null);
    setProfileSuccess(null);

    if (!nextUsername || !USERNAME_PATTERN.test(nextUsername)) {
      setProfileError("Username must be 3-32 chars and use letters, numbers, or underscore.");
      return;
    }

    if (!nextEmail || !EMAIL_PATTERN.test(nextEmail)) {
      setProfileError("Enter a valid email address.");
      return;
    }

    if (passwordFieldsTouched) {
      if (!currentPassword) {
        setProfileError("Enter your current password to set a new one.");
        return;
      }

      if (!newPassword) {
        setProfileError("Enter a new password.");
        return;
      }

      if (newPassword.length < MIN_PASSWORD_LENGTH) {
        setProfileError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
        return;
      }

      if (newPassword !== confirmPassword) {
        setProfileError("New password and confirm password must match.");
        return;
      }
    }

    if (
      nextUsername === accountUser.username &&
      nextEmail === accountUser.email &&
      !passwordFieldsTouched
    ) {
      setProfileSuccess("No changes to save.");
      return;
    }

    setSavingProfile(true);

    try {
      const response = await fetchJson<UpdateProfileResponse>("/api/me", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: nextUsername,
          email: nextEmail,
          currentPassword: passwordFieldsTouched ? currentPassword : undefined,
          newPassword: passwordFieldsTouched ? newPassword : undefined,
        }),
      });

      setAccountUser(response.user);
      setMessages((previous) => syncMessagesWithProfileUpdate(previous, response.user));
      setReplyingTo((previous) =>
        previous && previous.senderId === response.user.id
          ? {
              ...previous,
              senderUsername: response.user.username,
            }
          : previous,
      );
      setProfileUsername(response.user.username);
      setProfileEmail(response.user.email);
      setProfileCurrentPassword("");
      setProfileNewPassword("");
      setProfileConfirmPassword("");
      setProfileSuccess(
        passwordFieldsTouched ? "Profile and password updated." : "Profile updated.",
      );
      startTransition(() => {
        router.refresh();
      });
    } catch (profileUpdateError) {
      setProfileError(
        profileUpdateError instanceof Error
          ? profileUpdateError.message
          : "Failed to update profile.",
      );
    } finally {
      setSavingProfile(false);
    }
  }

  async function onLogout() {
    const socket = socketRef.current;
    if (socket) {
      socket.disconnect();
      socketRef.current = null;
    }

    const desktop = getDesktopBridge();
    if (desktop) {
      void desktop.setBadgeCount(0);
      void desktop.stopFlashWindow();
    }

    clearStoredPinUnlockToken();

    try {
      await fetchJson("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId]);

  useEffect(() => {
    const desktop = getDesktopBridge();
    if (!desktop) {
      return;
    }

    void desktop.setBadgeCount(totalUnreadCount);
    if (totalUnreadCount === 0) {
      void desktop.stopFlashWindow();
    }
  }, [totalUnreadCount]);

  useEffect(() => {
    if (!profileOpen || typeof window === "undefined") {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeProfilePanel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeProfilePanel, profileOpen]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const handleVisibilityChange = () => {
      setIsPageVisible(document.visibilityState === "visible");
    };
    const handleOnline = () => {
      setIsBrowserOnline(true);
    };
    const handleOffline = () => {
      setIsBrowserOnline(false);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (!selectedConversationId) {
      setMessages([]);
      setNextCursor(null);
      return;
    }

    void loadMessages(selectedConversationId);
  }, [loadMessages, selectedConversationId]);

  useEffect(() => {
    setReplyingTo(null);
  }, [selectedConversationId]);

  useEffect(() => {
    if (socketConnected) {
      return;
    }

    let canceled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failureCount = 0;

    const schedule = (delayMs: number) => {
      if (canceled) {
        return;
      }

      timer = setTimeout(() => {
        void tick();
      }, delayMs);
    };

    const nextBackoffDelay = () =>
      Math.min(POLL_BACKOFF_MAX_MS, POLL_CONVERSATIONS_INTERVAL_MS * 2 ** Math.min(failureCount, 4));

    const tick = async () => {
      if (canceled) {
        return;
      }

      if (!isBrowserOnline || (!desktopShell && !isPageVisible) || cameraOpen) {
        schedule(POLL_CONVERSATIONS_INTERVAL_MS);
        return;
      }

      try {
        await loadConversations({ silent: true });
        failureCount = 0;
        schedule(POLL_CONVERSATIONS_INTERVAL_MS);
      } catch {
        failureCount += 1;
        schedule(nextBackoffDelay());
      }
    };

    schedule(900);

    return () => {
      canceled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [cameraOpen, desktopShell, isBrowserOnline, isPageVisible, loadConversations, socketConnected]);

  useEffect(() => {
    if (socketConnected || !selectedConversationId) {
      return;
    }

    let canceled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failureCount = 0;

    const schedule = (delayMs: number) => {
      if (canceled) {
        return;
      }

      timer = setTimeout(() => {
        void tick();
      }, delayMs);
    };

    const nextBackoffDelay = () =>
      Math.min(POLL_BACKOFF_MAX_MS, POLL_MESSAGES_INTERVAL_MS * 2 ** Math.min(failureCount, 4));

    const tick = async () => {
      if (canceled) {
        return;
      }

      if (!isBrowserOnline || !isPageVisible || cameraOpen || sendingMessage || uploadingImage) {
        schedule(POLL_MESSAGES_INTERVAL_MS);
        return;
      }

      try {
        await loadMessages(selectedConversationId, null, { silent: true });
        failureCount = 0;
        schedule(POLL_MESSAGES_INTERVAL_MS);
      } catch {
        failureCount += 1;
        schedule(nextBackoffDelay());
      }
    };

    schedule(600);

    return () => {
      canceled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [
    cameraOpen,
    isBrowserOnline,
    isPageVisible,
    loadMessages,
    selectedConversationId,
    sendingMessage,
    socketConnected,
    uploadingImage,
  ]);

  useEffect(() => {
    if (!cameraOpen || !cameraStreamRef.current || !cameraVideoRef.current) {
      return;
    }

    cameraVideoRef.current.srcObject = cameraStreamRef.current;
    void cameraVideoRef.current.play().catch(() => undefined);
  }, [cameraFacingMode, cameraOpen]);

  useEffect(() => {
    if (selectedConversationId || !cameraOpen) {
      return;
    }

    if (cameraStreamRef.current) {
      for (const track of cameraStreamRef.current.getTracks()) {
        track.stop();
      }
      cameraStreamRef.current = null;
    }

    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null;
    }

    setCameraOpen(false);
  }, [cameraOpen, selectedConversationId]);

  useEffect(() => {
    return () => {
      if (cameraStreamRef.current) {
        for (const track of cameraStreamRef.current.getTracks()) {
          track.stop();
        }
        cameraStreamRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!messagePanelFullscreen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMessagePanelFullscreen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [messagePanelFullscreen]);

  useEffect(() => {
    let mounted = true;
    let refreshingSocketAuth = false;
    let socketAuthRefreshAttempts = 0;

    async function refreshSocketToken(socket: SocketClient) {
      if (!mounted || refreshingSocketAuth || socketAuthRefreshAttempts >= 1) {
        return;
      }

      refreshingSocketAuth = true;
      socketAuthRefreshAttempts += 1;

      try {
        const nextToken = await fetchRealtimeToken();
        if (!mounted || socketRef.current !== socket) {
          return;
        }

        socket.auth = {
          realtimeToken: nextToken.realtimeToken,
        };
        socket.connect();
      } catch {
        setSocketConnected(false);
      } finally {
        refreshingSocketAuth = false;
      }
    }

    async function initSocket() {
      if (!realtimeServerUrl) {
        setSocketConnected(false);
        return;
      }

      const pinUnlockToken = getStoredPinUnlockToken();
      if (!pinUnlockToken) {
        setSocketConnected(false);
        dispatchPinLock();
        return;
      }

      try {
        const realtimeTokenResponse = await fetchRealtimeToken();

        if (!mounted) {
          return;
        }

        const socket = io(realtimeServerUrl, {
          autoConnect: false,
          path: realtimeSocketPath,
          auth: {
            realtimeToken: realtimeTokenResponse.realtimeToken,
          },
          // Establish polling first, then upgrade to WebSocket when available.
          transports: ["polling", "websocket"],
          tryAllTransports: true,
          timeout: 5_000,
        });
        socketRef.current = socket;
        setSocketInstance(socket);

        socket.on("connect", () => {
          socketAuthRefreshAttempts = 0;
          setSocketConnected(true);
        });

        socket.on("disconnect", () => {
          setSocketConnected(false);
        });

        socket.on("connect_error", (error) => {
          setSocketConnected(false);
          if (isPinAccessErrorCode(error.message)) {
            clearStoredPinUnlockToken();
            dispatchPinLock();
            return;
          }

          if (isRealtimeTokenRefreshErrorCode(error.message)) {
            void refreshSocketToken(socket);
          }
        });

        socket.on("chat:new_message", (payload) => {
          const incomingMessage = toMessageFromSocket(payload);
          const activeConversationId = selectedConversationIdRef.current;
          const shouldTreatAsUnread =
            incomingMessage.senderId !== accountUser.id &&
            !isConversationActivelyViewed(incomingMessage.conversationId);
          const latestUnreadMessage = toConversationUnreadMessage(
            incomingMessage,
            payload.sender.username,
          );

          observedUnreadMessageIdsRef.current.set(incomingMessage.conversationId, incomingMessage.id);

          if (shouldTreatAsUnread && desktopShell) {
            showDesktopNotification({
              conversationId: incomingMessage.conversationId,
              latestUnreadMessage,
            });
          }

          setConversations((previous) => {
            const updated = updateConversationPreview(previous, incomingMessage, shouldTreatAsUnread
              ? {
                  unreadDelta: 1,
                  latestUnreadMessage,
                }
              : undefined);
            if (updated === previous) {
              void loadConversations();
            }
            return updated;
          });

          if (incomingMessage.conversationId === activeConversationId) {
            setMessages((previous) => {
              if (previous.some((message) => message.id === incomingMessage.id)) {
                return previous;
              }
              return [incomingMessage, ...previous];
            });
          }

          socket.emit("chat:message_delivered", { messageId: incomingMessage.id });
        });

        socket.on("chat:message_status_updated", (payload) => {
          setMessages((previous) => updateMessageStatusLocally(previous, payload));
          setConversations((previous) => updateConversationStatusLocally(previous, payload));
        });

        socket.connect();
      } catch {
        setSocketConnected(false);
      }
    }

    void initSocket();

    return () => {
      mounted = false;
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setSocketInstance(null);
    };
  }, [
    accountUser.id,
    desktopShell,
    isConversationActivelyViewed,
    loadConversations,
    realtimeServerUrl,
    realtimeSocketPath,
    showDesktopNotification,
  ]);

  useEffect(() => {
    if (!selectedConversationId || messages.length === 0) {
      return;
    }

    const newestMessage = messages[0];
    const persistedId = isUuid(newestMessage.id) ? newestMessage.id : null;
    const readMarker = persistedId ?? newestMessage.createdAt;
    const readKey = `${selectedConversationId}:${readMarker}`;
    if (lastReadEventRef.current === readKey) {
      return;
    }

    lastReadEventRef.current = readKey;
    const payload: MessageReadPayload = persistedId
      ? {
          conversationId: selectedConversationId,
          lastReadMessageId: persistedId,
        }
      : {
          conversationId: selectedConversationId,
          timestamp: newestMessage.createdAt,
        };

    void markConversationRead(payload)
      .then(() => {
        setMessages((previous) =>
          markMessagesReadLocally(previous, selectedConversationId, accountUser.id, newestMessage.createdAt),
        );
        setConversations((previous) =>
          clearConversationUnreadState(
            previous,
            selectedConversationId,
            accountUser.id,
            newestMessage.createdAt,
          ),
        );
      })
      .catch(() => {
        if (lastReadEventRef.current === readKey) {
          lastReadEventRef.current = null;
        }
      });
  }, [accountUser.id, markConversationRead, messages, selectedConversationId]);

  useEffect(() => {
    const container = messageScrollRef.current;
    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, [selectedConversationId, newestMessageId]);

  return (
    <div className="h-screen overflow-hidden px-3 py-4 sm:px-5 sm:py-6 lg:px-8 lg:py-8">
      <div className="mx-auto flex h-full w-full max-w-7xl flex-col gap-4 overflow-hidden">
        <header
          className={`flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-4 shadow-[0_14px_34px_rgba(17,17,17,0.06)] sm:flex-row sm:items-start sm:justify-between sm:px-5 ${
            messagePanelFullscreen ? "hidden" : ""
          }`}
        >
          <div>
            <BrandMark size="sm" priority subtitle="Private workspace" />
            <p className="mt-3 text-sm text-black/70">
              Signed in as {accountUser.username} ({accountUser.email})
            </p>
            <p className="text-xs font-medium uppercase tracking-wide text-black/55">
              Realtime: {realtimeStatus}
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={openProfilePanel}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-black transition hover:bg-stone-100 sm:w-auto"
            >
              <SettingsIcon />
              Settings
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="w-full rounded-xl border border-stone-300 bg-amber-100 px-3 py-2 text-sm font-semibold text-black transition hover:bg-amber-200 sm:w-auto"
            >
              Logout
            </button>
          </div>
        </header>

        {error ? (
          <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div
          className={
            messagePanelFullscreen
              ? "min-h-0 flex-1"
              : "grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]"
          }
        >
          {!messagePanelFullscreen ? (
            <aside className="flex min-h-0 flex-col rounded-2xl border border-stone-200 bg-white p-4 shadow-[0_14px_34px_rgba(17,17,17,0.05)]">
            <div className="mb-4 rounded-xl border border-stone-200 bg-stone-50 p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-black">
                Start private chat
              </h3>
              <p className="mt-1 text-xs text-black/65">
                Only you and selected user can read that conversation.
              </p>
              <form onSubmit={onSearchDirectoryUser} className="mt-3 space-y-2">
                <input
                  type="email"
                  value={directoryQuery}
                  onChange={(event) => {
                    setDirectoryQuery(event.target.value);
                    setDirectorySearchResult(null);
                    setDirectorySearchMessage(null);
                  }}
                  placeholder="Enter full email address"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="w-full rounded-lg border border-stone-300 bg-white px-2.5 py-2 text-xs text-black outline-none transition focus:border-stone-700 focus:ring-2 focus:ring-stone-300"
                />
                <button
                  type="submit"
                  disabled={!directoryQuery.trim() || searchingDirectoryUser || creatingConversation}
                  className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-black transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:bg-stone-200"
                >
                  {searchingDirectoryUser ? "Searching..." : "Search"}
                </button>
              </form>
              {directorySearchResult ? (
                <div className="mt-2 rounded-lg border border-stone-200 bg-white px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-black/55">
                    User found
                  </p>
                  <p className="mt-1 text-sm font-semibold text-black">
                    {directorySearchResult.username}
                  </p>
                  <p className="text-xs text-black/65">{directorySearchResult.email}</p>
                </div>
              ) : null}
              {directorySearchMessage ? (
                <p className="mt-2 text-xs text-black/60">{directorySearchMessage}</p>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  void onStartConversation();
                }}
                disabled={!directorySearchResult || searchingDirectoryUser || creatingConversation}
                className="mt-2 w-full rounded-lg border border-stone-300 bg-amber-100 px-3 py-2 text-xs font-semibold text-black transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:bg-stone-200"
              >
                {creatingConversation ? "Starting..." : "Start chat"}
              </button>
            </div>

            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-black">
              Conversations
            </h2>
            {loadingConversations ? <p className="text-sm text-black/70">Loading...</p> : null}

            {!loadingConversations && conversations.length === 0 ? (
              <p className="text-sm text-black/70">No conversations yet. Start one above.</p>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => selectConversation(conversation.id)}
                  className={`group block w-full rounded-2xl border px-3 py-3 text-left transition ${
                    conversation.id === selectedConversationId
                      ? "border-stone-900 bg-stone-900 text-white shadow-[0_18px_36px_rgba(17,17,17,0.14)]"
                      : "border-stone-200 bg-white text-black hover:border-stone-300 hover:bg-stone-50"
                  } ${conversation.id === conversations[0]?.id ? "" : "mt-2"}`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-semibold ${
                        conversation.id === selectedConversationId
                          ? "bg-white/14 text-white"
                          : conversation.unreadCount > 0
                            ? "bg-amber-100 text-amber-900"
                            : "bg-stone-100 text-stone-700"
                      }`}
                    >
                      {getUserInitials(conversation.otherUser.username)}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {conversation.otherUser.username}
                          </p>
                          <p
                            className={`mt-1 truncate text-sm ${
                              conversation.id === selectedConversationId
                                ? "text-white/80"
                                : conversation.unreadCount > 0
                                  ? "font-medium text-black"
                                  : "text-black/60"
                            }`}
                          >
                            {conversationPreviewText(conversation, accountUser.id)}
                          </p>
                        </div>

                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span
                            className={`text-[11px] font-medium ${
                              conversation.id === selectedConversationId
                                ? "text-white/70"
                                : conversation.unreadCount > 0
                                  ? "text-amber-800"
                                  : "text-black/45"
                            }`}
                          >
                            {formatConversationTimestamp(conversation.lastActivityAt)}
                          </span>
                          {conversation.unreadCount > 0 ? (
                            <span
                              className={`min-w-6 rounded-full px-2 py-0.5 text-center text-[11px] font-semibold ${
                                conversation.id === selectedConversationId
                                  ? "bg-white text-stone-900"
                                  : "bg-amber-200 text-black"
                              }`}
                            >
                              {conversation.unreadCount}
                            </span>
                          ) : (
                            <span
                              className={`h-2.5 w-2.5 rounded-full ${
                                conversation.id === selectedConversationId
                                  ? "bg-white/35"
                                  : "bg-stone-200"
                              }`}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
            </aside>
          ) : null}

          <section
            className={`flex min-h-0 flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white p-4 shadow-[0_14px_34px_rgba(17,17,17,0.05)] sm:p-5 ${
              messagePanelFullscreen ? "fixed inset-2 z-40 sm:inset-4" : ""
            }`}
          >
            <div className="mb-3 flex items-center justify-between gap-3 border-b border-stone-200 pb-3">
              <h2 className="text-lg font-semibold text-black">
                {selectedConversation
                  ? `${selectedConversation.otherUser.username}`
                  : "No chat selected"}
              </h2>
              <div className="flex items-center gap-2">
                {desktopShell ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void callController.startAudioCall()}
                      disabled={!selectedConversation || !callController.canCall}
                      title={callController.availabilityMessage ?? "Start a voice call"}
                      className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-black/40"
                    >
                      Voice call
                    </button>
                    <button
                      type="button"
                      onClick={() => void callController.startVideoCall()}
                      disabled={!selectedConversation || !callController.canCall}
                      title={callController.availabilityMessage ?? "Start a video call"}
                      className="rounded-lg border border-stone-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-black/40"
                    >
                      Video call
                    </button>
                  </>
                ) : null}
                {selectedConversation ? (
                  <button
                    type="button"
                    onClick={closeConversation}
                    className="rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-stone-100"
                  >
                    Close chat
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setMessagePanelFullscreen((previous) => !previous)}
                  disabled={!selectedConversation}
                  className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-black/40"
                >
                  {messagePanelFullscreen ? "Exit full screen" : "Full screen"}
                </button>
              </div>
            </div>

            {selectedConversation ? (
              <>
                <div ref={messageScrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-3 pr-1">
                  {loadingMessages ? <p className="text-sm text-black/70">Loading messages...</p> : null}

                  {!loadingMessages && messages.length === 0 ? (
                    <p className="text-sm text-black/70">No messages in this conversation yet.</p>
                  ) : null}

                  {nextCursor ? (
                    <button
                      type="button"
                      onClick={() =>
                        selectedConversationId ? loadMessages(selectedConversationId, nextCursor) : null
                      }
                      className="rounded-xl border border-stone-300 px-3 py-1 text-xs font-semibold text-black transition hover:bg-stone-100"
                    >
                      Load older messages
                    </button>
                  ) : null}

                  {displayedMessages.map((message) => {
                    const isCurrentUser = message.senderId === accountUser.id;
                    const normalizedImageUrl =
                      message.type === "IMAGE" && message.imageKey
                        ? normalizeMessageImageUrl(message.imageKey)
                        : null;
                    const replySnippet = message.replyTo ? messageReplyPreview(message.replyTo) : null;

                    return (
                      <div
                        key={message.id}
                        className={`max-w-[92%] rounded-xl border px-3 py-2 text-sm shadow-[0_6px_16px_rgba(17,17,17,0.04)] sm:max-w-[80%] ${
                          isCurrentUser
                            ? "ml-auto border-amber-200 bg-amber-100 text-black"
                            : "border-stone-200 bg-stone-100 text-black"
                        }`}
                      >
                        <div className="mb-1 flex items-center justify-between gap-3">
                          <p className="text-xs font-medium opacity-80">
                            {message.sender.username} | {message.status}
                          </p>
                          <button
                            type="button"
                            onClick={() => setReplyingTo(toReplyTarget(message))}
                            className="rounded-md border border-black/15 bg-white/60 px-2 py-0.5 text-[11px] font-semibold text-black/80 transition hover:bg-white"
                          >
                            Reply
                          </button>
                        </div>
                        {message.replyTo ? (
                          <div className="mb-2 rounded-lg border border-black/10 bg-white/45 px-2 py-1">
                            <p className="text-[11px] font-semibold text-black/75">
                              {message.replyTo.senderId === accountUser.id
                                ? "You"
                                : message.replyTo.senderUsername}
                            </p>
                            <p className="truncate text-xs text-black/70">{replySnippet}</p>
                          </div>
                        ) : null}
                        {message.type === "IMAGE" && normalizedImageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={normalizedImageUrl}
                            alt="Chat upload"
                            className="max-h-64 w-auto max-w-full cursor-zoom-in rounded-lg object-cover"
                            loading="lazy"
                            onClick={() => setLightboxUrl(normalizedImageUrl)}
                          />
                        ) : (
                          <p className="whitespace-pre-wrap break-words">{message.text ?? "[unsupported message]"}</p>
                        )}
                        <p className="mt-1 text-xs opacity-70">
                          {new Date(message.createdAt).toLocaleString()}
                        </p>
                      </div>
                    );
                  })}
                </div>

                <Composer
                  draft={draft}
                  selectedConversationId={selectedConversationId}
                  sendingMessage={sendingMessage}
                  uploadingImage={uploadingImage}
                  cameraStarting={cameraStarting}
                  currentUserId={accountUser.id}
                  replyingTo={replyingTo}
                  onDraftChange={setDraft}
                  onCancelReply={() => setReplyingTo(null)}
                  onSendMessage={onSendMessage}
                  onImageSelected={onImageSelected}
                  onOpenCamera={openCameraModal}
                />
              </>
            ) : (
              <div className="flex min-h-0 flex-1 items-center justify-center">
                <div className="max-w-sm rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-6 py-8 text-center">
                  <p className="text-sm font-semibold uppercase tracking-[0.2em] text-black/45">
                    Inbox
                  </p>
                  <h3 className="mt-3 text-2xl font-semibold text-black">No chat selected</h3>
                  <p className="mt-2 text-sm leading-6 text-black/65">
                    Choose a conversation from the left, or start a new private chat to open a thread.
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>

        {profileOpen ? (
          <div
            className="fixed inset-0 z-50 overflow-y-auto bg-black/45 p-2 sm:p-4"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                closeProfilePanel();
              }
            }}
          >
            <div className="flex min-h-full items-start justify-center py-3 sm:items-center sm:py-6">
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="profile-dialog-title"
                className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-[30px] border border-stone-200/90 bg-[#fffdf7] shadow-[0_32px_90px_rgba(17,17,17,0.24)] sm:max-h-[calc(100dvh-3rem)]"
              >
                <div className="border-b border-stone-200 bg-[linear-gradient(135deg,rgba(251,191,36,0.16),rgba(255,250,240,0.98))] px-4 py-4 sm:px-6 sm:py-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-700/80">
                        Account settings
                      </p>
                      <h3
                        id="profile-dialog-title"
                        className="mt-2 text-2xl font-semibold tracking-tight text-black sm:text-[2rem]"
                      >
                        Profile and security
                      </h3>
                      <p className="mt-2 max-w-3xl text-sm leading-6 text-black/65 sm:text-[15px]">
                        Review your account details, update your username or email, and confirm your
                        current password before changing it.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={closeProfilePanel}
                      disabled={savingProfile}
                      className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-black transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:bg-stone-100 sm:w-auto"
                    >
                      Close
                    </button>
                  </div>
                </div>

                <form onSubmit={onSaveProfile} className="flex min-h-0 flex-1 flex-col">
                  <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
                    <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)] xl:gap-5">
                      <aside className="self-start rounded-[24px] border border-stone-200 bg-white p-4 shadow-[0_12px_30px_rgba(17,17,17,0.06)] sm:p-5">
                        <div className="rounded-[22px] border border-amber-200 bg-[linear-gradient(180deg,rgba(255,246,214,0.95),rgba(251,191,36,0.12))] p-4">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-800/75">
                            Active profile
                          </p>
                          <p className="mt-3 text-xl font-semibold tracking-tight text-black">
                            {accountUser.username}
                          </p>
                          <p className="mt-1 break-all text-sm text-black/65">{accountUser.email}</p>
                        </div>

                        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-black/45">
                              Member since
                            </p>
                            <p className="mt-1 text-sm font-medium text-black">{memberSinceLabel}</p>
                          </div>
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-black/45">
                              Security rule
                            </p>
                            <p className="mt-1 text-sm leading-6 text-black/65">
                              Password changes require your current password first.
                            </p>
                          </div>
                        </div>
                      </aside>

                      <div className="min-w-0 space-y-4 sm:space-y-5">
                        {profileError ? (
                          <div className="rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
                            {profileError}
                          </div>
                        ) : null}
                        {profileSuccess ? (
                          <div className="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                            {profileSuccess}
                          </div>
                        ) : null}

                        <section className="rounded-[24px] border border-stone-200 bg-white p-4 shadow-[0_12px_30px_rgba(17,17,17,0.05)] sm:p-5">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-black/45">
                            Profile
                          </p>
                          <h4 className="mt-2 text-xl font-semibold tracking-tight text-black">
                            Update visible account details
                          </h4>

                          <div className="mt-4 grid gap-4 md:grid-cols-2">
                            <label className="block">
                              <span className="text-xs font-semibold uppercase tracking-wide text-black/55">
                                Username
                              </span>
                              <input
                                type="text"
                                value={profileUsername}
                                onChange={(event) => {
                                  setProfileUsername(event.target.value);
                                  setProfileError(null);
                                  setProfileSuccess(null);
                                }}
                                autoComplete="username"
                                className="mt-2 w-full rounded-xl border border-stone-300 bg-white px-3 py-3 text-sm text-black outline-none transition focus:border-stone-700 focus:ring-2 focus:ring-stone-300"
                              />
                            </label>

                            <label className="block">
                              <span className="text-xs font-semibold uppercase tracking-wide text-black/55">
                                Email
                              </span>
                              <input
                                type="email"
                                value={profileEmail}
                                onChange={(event) => {
                                  setProfileEmail(event.target.value);
                                  setProfileError(null);
                                  setProfileSuccess(null);
                                }}
                                autoCapitalize="none"
                                autoCorrect="off"
                                spellCheck={false}
                                autoComplete="email"
                                className="mt-2 w-full rounded-xl border border-stone-300 bg-white px-3 py-3 text-sm text-black outline-none transition focus:border-stone-700 focus:ring-2 focus:ring-stone-300"
                              />
                            </label>
                          </div>
                        </section>

                        <section className="rounded-[24px] border border-stone-200 bg-white p-4 shadow-[0_12px_30px_rgba(17,17,17,0.05)] sm:p-5">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-black/45">
                            Password
                          </p>
                          <h4 className="mt-2 text-xl font-semibold tracking-tight text-black">
                            Change password
                          </h4>
                          <p className="mt-2 max-w-2xl text-sm leading-6 text-black/65">
                            Leave these fields blank if you only want to update username or email.
                          </p>

                          <div className="mt-4 grid gap-4 md:grid-cols-2">
                            <label className="block md:col-span-2">
                              <span className="text-xs font-semibold uppercase tracking-wide text-black/55">
                                Current password
                              </span>
                              <input
                                type="password"
                                value={profileCurrentPassword}
                                onChange={(event) => {
                                  setProfileCurrentPassword(event.target.value);
                                  setProfileError(null);
                                  setProfileSuccess(null);
                                }}
                                autoComplete="current-password"
                                className="mt-2 w-full rounded-xl border border-stone-300 bg-white px-3 py-3 text-sm text-black outline-none transition focus:border-stone-700 focus:ring-2 focus:ring-stone-300"
                              />
                            </label>

                            <label className="block">
                              <span className="text-xs font-semibold uppercase tracking-wide text-black/55">
                                New password
                              </span>
                              <input
                                type="password"
                                value={profileNewPassword}
                                onChange={(event) => {
                                  setProfileNewPassword(event.target.value);
                                  setProfileError(null);
                                  setProfileSuccess(null);
                                }}
                                autoComplete="new-password"
                                className="mt-2 w-full rounded-xl border border-stone-300 bg-white px-3 py-3 text-sm text-black outline-none transition focus:border-stone-700 focus:ring-2 focus:ring-stone-300"
                              />
                            </label>

                            <label className="block">
                              <span className="text-xs font-semibold uppercase tracking-wide text-black/55">
                                Confirm new password
                              </span>
                              <input
                                type="password"
                                value={profileConfirmPassword}
                                onChange={(event) => {
                                  setProfileConfirmPassword(event.target.value);
                                  setProfileError(null);
                                  setProfileSuccess(null);
                                }}
                                autoComplete="new-password"
                                className="mt-2 w-full rounded-xl border border-stone-300 bg-white px-3 py-3 text-sm text-black outline-none transition focus:border-stone-700 focus:ring-2 focus:ring-stone-300"
                              />
                            </label>
                          </div>
                        </section>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-stone-200 bg-[#fffaf1]/95 px-4 py-4 backdrop-blur sm:px-6">
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                      <button
                        type="button"
                        onClick={closeProfilePanel}
                        disabled={savingProfile}
                        className="rounded-xl border border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:bg-stone-100"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={!profileHasChanges || savingProfile}
                        className="rounded-xl border border-stone-300 bg-amber-100 px-4 py-3 text-sm font-semibold text-black transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:bg-stone-200"
                      >
                        {savingProfile ? "Saving..." : "Save changes"}
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </div>
        ) : null}

        {cameraOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-4 shadow-[0_24px_60px_rgba(17,17,17,0.2)]">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-base font-semibold text-black">Capture photo</h3>
                <button
                  type="button"
                  onClick={closeCameraModal}
                  className="rounded-lg border border-stone-300 bg-white px-3 py-1 text-xs font-semibold text-black hover:bg-stone-100"
                >
                  Close
                </button>
              </div>

              <div className="overflow-hidden rounded-xl bg-black">
                <video
                  ref={cameraVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="h-[360px] w-full object-cover"
                />
              </div>

              <div className="mt-3 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => void switchCameraFacingMode()}
                  disabled={cameraStarting || uploadingImage}
                  className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-black transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:bg-stone-200"
                >
                  Switch to {cameraFacingMode === "environment" ? "front" : "back"}
                </button>
                <button
                  type="button"
                  onClick={() => void captureFromCamera()}
                  disabled={cameraStarting || uploadingImage}
                  className="rounded-xl border border-stone-300 bg-amber-100 px-4 py-2 text-sm font-semibold text-black transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:bg-stone-200"
                >
                  {uploadingImage ? "Uploading..." : "Capture & send"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {lightboxUrl ? (
          <div
            className="fixed inset-0 z-9999 flex items-center justify-center bg-black/80"
            onClick={() => setLightboxUrl(null)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightboxUrl}
              alt="Full size preview"
              className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              type="button"
              onClick={() => setLightboxUrl(null)}
              className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/30"
              aria-label="Close image preview"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        ) : null}

        <CallOverlay
          currentUserId={accountUser.id}
          currentCall={callController.currentCall}
          incomingCall={callController.incomingCall}
          localMediaState={callController.localMediaState}
          remoteMediaState={callController.remoteMediaState}
          localCameraStream={callController.localCameraStream}
          localScreenStream={callController.localScreenStream}
          remoteCameraStream={callController.remoteCameraStream}
          remoteScreenStream={callController.remoteScreenStream}
          remoteAudioStream={callController.remoteAudioStream}
          socketConnected={socketConnected}
          callError={callController.callError}
          iceConnectionState={callController.iceConnectionState}
          isStartingCall={callController.isStartingCall}
          isAcceptingCall={callController.isAcceptingCall}
          screenSharePickerOpen={callController.screenSharePickerOpen}
          screenShareSources={callController.screenShareSources}
          screenShareSystemAudio={callController.screenShareSystemAudio}
          screenShareLoading={callController.screenShareLoading}
          callCapabilities={callController.callCapabilities}
          onDismissCallError={callController.dismissCallError}
          onCloseScreenSharePicker={callController.closeScreenSharePicker}
          onSetScreenShareSystemAudio={callController.setScreenShareSystemAudio}
          onAcceptIncomingCall={callController.acceptIncomingCall}
          onRejectIncomingCall={callController.rejectIncomingCall}
          onEndCurrentCall={callController.endCurrentCall}
          onToggleMic={callController.toggleMic}
          onToggleCamera={callController.toggleCamera}
          onOpenScreenSharePicker={callController.openScreenSharePicker}
          onStartScreenShare={callController.startScreenShare}
          onStopScreenShare={callController.stopScreenShare}
        />
      </div>
    </div>
  );
}

