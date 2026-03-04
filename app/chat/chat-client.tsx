"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { io, Socket } from "socket.io-client";
import { PublicUser } from "@/lib/auth/current-user";
import { Composer } from "@/components/chat/Composer";
import {
  ChatMessageStatusUpdatedEvent,
  ChatNewMessageEvent,
  ClientToServerEvents,
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
};

type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  sender: PublicUser;
  type: "TEXT" | "IMAGE";
  text: string | null;
  imageKey: string | null;
  status: "SENT" | "DELIVERED" | "READ";
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

const SOCKET_ACK_TIMEOUT_MS = 8_000;
const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const POLL_MESSAGES_INTERVAL_MS = 2_500;
const POLL_CONVERSATIONS_INTERVAL_MS = 12_000;
const POLL_BACKOFF_MAX_MS = 60_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
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
    return trimmed;
  }

  if (trimmed.startsWith("chat-images/")) {
    return `/api/uploads/object/${encodeObjectKeyForProxy(trimmed)}`;
  }

  if (trimmed.startsWith("/")) {
    const objectKey = extractObjectKeyFromPathname(trimmed);
    if (objectKey) {
      return `/api/uploads/object/${encodeObjectKeyForProxy(objectKey)}`;
    }
    return trimmed;
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const parsed = new URL(trimmed);

      if (parsed.pathname.startsWith("/api/uploads/object/")) {
        return parsed.pathname;
      }

      const objectKey = extractObjectKeyFromPathname(parsed.pathname);
      if (objectKey) {
        return `/api/uploads/object/${encodeObjectKeyForProxy(objectKey)}`;
      }
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

function shouldDisableRealtimeSocket(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return window.location.hostname.toLowerCase().endsWith(".vercel.app");
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
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const errorMessage =
      (payload as { error?: { message?: string } } | null)?.error?.message ??
      "Request failed.";
    throw new Error(errorMessage);
  }

  return payload as T;
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

function updateConversationPreview(
  previous: Conversation[],
  message: SocketMessage | Message,
): Conversation[] {
  const targetIndex = previous.findIndex(
    (conversation) => conversation.id === message.conversationId,
  );

  if (targetIndex < 0) {
    return previous;
  }

  const target = previous[targetIndex];
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
  };

  const next = previous.filter((_, index) => index !== targetIndex);
  return [updatedConversation, ...next];
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

export function ChatClient({ currentUser }: { currentUser: PublicUser }) {
  const router = useRouter();
  const socketRef = useRef<SocketClient | null>(null);
  const selectedConversationIdRef = useRef<string | null>(null);
  const lastReadEventRef = useRef<string | null>(null);
  const messageScrollRef = useRef<HTMLDivElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraFacingMode, setCameraFacingMode] = useState<CameraFacingMode>("environment");
  const [messagePanelFullscreen, setMessagePanelFullscreen] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [directoryUsers, setDirectoryUsers] = useState<PublicUser[]>([]);
  const [directoryQuery, setDirectoryQuery] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [loadingDirectoryUsers, setLoadingDirectoryUsers] = useState(false);
  const [creatingConversation, setCreatingConversation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPageVisible, setIsPageVisible] = useState(
    () => (typeof document === "undefined" ? true : document.visibilityState === "visible"),
  );
  const [isBrowserOnline, setIsBrowserOnline] = useState(
    () => (typeof navigator === "undefined" ? true : navigator.onLine),
  );

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId],
  );
  const displayedMessages = useMemo(() => [...messages].reverse(), [messages]);
  const newestMessageId = messages[0]?.id ?? null;
  const realtimeStatus = socketConnected
    ? "connected"
    : isBrowserOnline
      ? isPageVisible
        ? "polling fallback active"
        : "paused (tab hidden)"
      : "offline";

  const loadConversations = useCallback(async (options: { silent?: boolean } = {}) => {
    const silent = options.silent === true;
    if (!silent) {
      setLoadingConversations(true);
      setError(null);
    }

    try {
      const data = await fetchJson<ConversationsResponse>("/api/conversations");
      setConversations(data.conversations);

      setSelectedConversationId((previousSelectedConversationId) => {
        if (data.conversations.length === 0) {
          setMessages([]);
          setNextCursor(null);
          return null;
        }

        if (!previousSelectedConversationId) {
          return data.conversations[0].id;
        }

        const selectedStillExists = data.conversations.some(
          (conversation) => conversation.id === previousSelectedConversationId,
        );

        return selectedStillExists ? previousSelectedConversationId : data.conversations[0].id;
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
  }, []);

  const loadDirectoryUsers = useCallback(async (query: string) => {
    setLoadingDirectoryUsers(true);

    try {
      const params = new URLSearchParams();
      if (query.trim()) {
        params.set("query", query.trim());
      }

      const suffix = params.toString() ? `?${params.toString()}` : "";
      const data = await fetchJson<UsersResponse>(`/api/users${suffix}`);
      setDirectoryUsers(data.users);
      setSelectedUserId((previous) =>
        data.users.some((user) => user.id === previous) ? previous : "",
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load users.");
    } finally {
      setLoadingDirectoryUsers(false);
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

  async function sendViaRestFallback(payload: {
    conversationId: string;
    text?: string;
    imageUrl?: string;
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

    setSendingMessage(true);
    setError(null);
    setDraft("");

    const clientMessageId = `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const optimisticMessage: Message = {
      id: clientMessageId,
      conversationId,
      senderId: currentUser.id,
      sender: currentUser,
      type: "TEXT",
      text,
      imageKey: null,
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
          clientMessageId,
        });

        if (ack.ok && ack.data) {
          storedMessage = toMessageFromSocketAck(ack.data);
        } else {
          storedMessage = await sendViaRestFallback({
            conversationId,
            text,
          });
        }
      } else {
        storedMessage = await sendViaRestFallback({
          conversationId,
          text,
        });
      }

      setMessages((previous) =>
        previous.map((message) => (message.id === clientMessageId ? storedMessage : message)),
      );
      setConversations((previous) => updateConversationPreview(previous, storedMessage));
    } catch (sendError) {
      setMessages((previous) => previous.filter((message) => message.id !== clientMessageId));
      setDraft(text);
      setError(sendError instanceof Error ? sendError.message : "Failed to send message.");
    } finally {
      setSendingMessage(false);
    }
  }

  async function uploadImageToObjectStore(file: File, contentType: string): Promise<string> {
    async function uploadViaRelay(): Promise<string> {
      const formData = new FormData();
      formData.set("file", file, file.name || `upload-${Date.now()}.jpg`);

      const response = await fetch("/api/uploads/relay", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          (payload as { error?: { message?: string } } | null)?.error?.message ??
          "Image upload failed.";
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

  async function sendImageMessage(conversationId: string, imageUrl: string) {
    const clientMessageId = `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const optimisticMessage: Message = {
      id: clientMessageId,
      conversationId,
      senderId: currentUser.id,
      sender: currentUser,
      type: "IMAGE",
      text: null,
      imageKey: imageUrl,
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
          clientMessageId,
        });

        if (ack.ok && ack.data) {
          storedMessage = toMessageFromSocketAck(ack.data);
        } else {
          storedMessage = await sendViaRestFallback({
            conversationId,
            imageUrl,
          });
        }
      } else {
        storedMessage = await sendViaRestFallback({
          conversationId,
          imageUrl,
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
      await sendImageMessage(conversationId, imageUrl);
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

  async function onStartConversation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedUserId || creatingConversation) {
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
          otherUserId: selectedUserId,
        }),
      });

      await loadConversations();
      setSelectedConversationId(response.conversationId);
      setMessages([]);
      setNextCursor(null);
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "Failed to start conversation.",
      );
    } finally {
      setCreatingConversation(false);
    }
  }

  async function onLogout() {
    const socket = socketRef.current;
    if (socket) {
      socket.disconnect();
      socketRef.current = null;
    }

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
    const timer = setTimeout(() => {
      void loadDirectoryUsers(directoryQuery);
    }, 250);

    return () => {
      clearTimeout(timer);
    };
  }, [directoryQuery, loadDirectoryUsers]);

  useEffect(() => {
    if (!selectedConversationId) {
      return;
    }

    void loadMessages(selectedConversationId);
  }, [loadMessages, selectedConversationId]);

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

      if (!isBrowserOnline || !isPageVisible || cameraOpen) {
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
  }, [cameraOpen, isBrowserOnline, isPageVisible, loadConversations, socketConnected]);

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

    async function initSocket() {
      if (shouldDisableRealtimeSocket()) {
        setSocketConnected(false);
        return;
      }

      try {
        await fetchJson<{ ok: boolean }>("/api/socket", {
          method: "GET",
          cache: "no-store",
        });

        if (!mounted) {
          return;
        }

        const socket = io({
          path: "/api/socket/io",
          withCredentials: true,
          transports: ["websocket", "polling"],
          reconnectionAttempts: 3,
          timeout: 5_000,
        });
        socketRef.current = socket;

        socket.on("connect", () => {
          setSocketConnected(true);
        });

        socket.on("disconnect", () => {
          setSocketConnected(false);
        });

        socket.on("connect_error", () => {
          setSocketConnected(false);
        });

        socket.on("chat:new_message", (payload) => {
          const incomingMessage = toMessageFromSocket(payload);
          const activeConversationId = selectedConversationIdRef.current;

          setConversations((previous) => {
            const updated = updateConversationPreview(previous, incomingMessage);
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
    };
  }, [loadConversations]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !socket.connected || !selectedConversationId || messages.length === 0) {
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
    if (persistedId) {
      socket.emit("chat:message_read", {
        conversationId: selectedConversationId,
        lastReadMessageId: persistedId,
      });
      return;
    }

    socket.emit("chat:message_read", {
      conversationId: selectedConversationId,
      timestamp: newestMessage.createdAt,
    });
  }, [messages, selectedConversationId, socketConnected]);

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
            <h1 className="text-2xl font-semibold text-black">Chat Workspace</h1>
            <p className="text-sm text-black/70">
              Signed in as {currentUser.username} ({currentUser.email})
            </p>
            <p className="text-xs font-medium uppercase tracking-wide text-black/55">
              Realtime: {realtimeStatus}
            </p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="w-full rounded-xl border border-stone-300 bg-amber-100 px-3 py-2 text-sm font-semibold text-black transition hover:bg-amber-200 sm:w-auto"
          >
            Logout
          </button>
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
              <form onSubmit={onStartConversation} className="mt-3 space-y-2">
                <input
                  value={directoryQuery}
                  onChange={(event) => setDirectoryQuery(event.target.value)}
                  placeholder="Search by username or email"
                  className="w-full rounded-lg border border-stone-300 bg-white px-2.5 py-2 text-xs text-black outline-none transition focus:border-stone-700 focus:ring-2 focus:ring-stone-300"
                />
                <select
                  value={selectedUserId}
                  onChange={(event) => setSelectedUserId(event.target.value)}
                  className="w-full rounded-lg border border-stone-300 bg-white px-2.5 py-2 text-xs text-black outline-none transition focus:border-stone-700 focus:ring-2 focus:ring-stone-300"
                >
                  <option value="">Select user</option>
                  {directoryUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.username} ({user.email})
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={!selectedUserId || creatingConversation}
                  className="w-full rounded-lg border border-stone-300 bg-amber-100 px-3 py-2 text-xs font-semibold text-black transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:bg-stone-200"
                >
                  {creatingConversation ? "Starting..." : "Start chat"}
                </button>
              </form>
              {loadingDirectoryUsers ? (
                <p className="mt-2 text-xs text-black/60">Loading users...</p>
              ) : null}
              {!loadingDirectoryUsers && directoryUsers.length === 0 ? (
                <p className="mt-2 text-xs text-black/60">
                  No users found. Create another account to start a private chat.
                </p>
              ) : null}
            </div>

            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-black">
              Conversations
            </h2>
            {loadingConversations ? <p className="text-sm text-black/70">Loading...</p> : null}

            {!loadingConversations && conversations.length === 0 ? (
              <p className="text-sm text-black/70">No conversations yet. Start one above.</p>
            ) : null}

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => setSelectedConversationId(conversation.id)}
                  className={`min-w-[240px] rounded-xl border px-3 py-2 text-left transition xl:min-w-0 ${
                    conversation.id === selectedConversationId
                      ? "border-stone-400 bg-amber-100 text-black"
                      : "border-stone-200 bg-white text-black hover:bg-stone-100"
                  }`}
                >
                  <p className="text-sm font-semibold">{conversation.otherUser.username}</p>
                  <p className="truncate text-xs opacity-80">
                    {conversation.lastMessage?.textPreview ?? "No messages yet"}
                  </p>
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
                  : "Select a conversation"}
              </h2>
              <button
                type="button"
                onClick={() => setMessagePanelFullscreen((previous) => !previous)}
                className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-stone-100"
              >
                {messagePanelFullscreen ? "Exit full screen" : "Full screen"}
              </button>
            </div>

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
                const isCurrentUser = message.senderId === currentUser.id;
                const normalizedImageUrl =
                  message.type === "IMAGE" && message.imageKey
                    ? normalizeMessageImageUrl(message.imageKey)
                    : null;

                return (
                  <div
                    key={message.id}
                    className={`max-w-[92%] rounded-xl border px-3 py-2 text-sm shadow-[0_6px_16px_rgba(17,17,17,0.04)] sm:max-w-[80%] ${
                      isCurrentUser
                        ? "ml-auto border-amber-200 bg-amber-100 text-black"
                        : "border-stone-200 bg-stone-100 text-black"
                    }`}
                  >
                    <p className="mb-1 text-xs font-medium opacity-80">
                      {message.sender.username} | {message.status}
                    </p>
                    {message.type === "IMAGE" && normalizedImageUrl ? (
                      <a href={normalizedImageUrl} target="_blank" rel="noopener noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={normalizedImageUrl}
                          alt="Chat upload"
                          className="max-h-64 w-auto max-w-full rounded-lg object-cover"
                          loading="lazy"
                        />
                      </a>
                    ) : (
                      <p>{message.text ?? "[unsupported message]"}</p>
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
              onDraftChange={setDraft}
              onSendMessage={onSendMessage}
              onImageSelected={onImageSelected}
              onOpenCamera={openCameraModal}
            />
          </section>
        </div>

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
      </div>
    </div>
  );
}

