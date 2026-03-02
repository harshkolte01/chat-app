"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { io, Socket } from "socket.io-client";
import { PublicUser } from "@/lib/auth/current-user";
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

type SocketClient = Socket<ServerToClientEvents, ClientToServerEvents>;

const SOCKET_ACK_TIMEOUT_MS = 8_000;

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
  return message.imageKey ?? "[image]";
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

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId],
  );

  const loadConversations = useCallback(async () => {
    setLoadingConversations(true);
    setError(null);

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
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load conversations.");
    } finally {
      setLoadingConversations(false);
    }
  }, []);

  const loadMessages = useCallback(async (conversationId: string, cursor: string | null = null) => {
    setLoadingMessages(true);
    setError(null);

    try {
      const query = new URLSearchParams({ conversationId });
      if (cursor) {
        query.set("cursor", cursor);
      }

      const data = await fetchJson<MessagesResponse>(`/api/messages?${query.toString()}`);
      setMessages((previous) => (cursor ? [...previous, ...data.messages] : data.messages));
      setNextCursor(data.nextCursor);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load messages.");
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  async function sendViaRestFallback(conversationId: string, text: string) {
    const response = await fetchJson<SendMessageResponse>("/api/messages/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId,
        text,
      }),
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
          storedMessage = await sendViaRestFallback(conversationId, text);
        }
      } else {
        storedMessage = await sendViaRestFallback(conversationId, text);
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
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (!selectedConversationId) {
      return;
    }

    void loadMessages(selectedConversationId);
  }, [loadMessages, selectedConversationId]);

  useEffect(() => {
    let mounted = true;

    async function initSocket() {
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
        });
        socketRef.current = socket;

        socket.on("connect", () => {
          setSocketConnected(true);
        });

        socket.on("disconnect", () => {
          setSocketConnected(false);
        });

        socket.on("connect_error", (connectError) => {
          setSocketConnected(false);
          setError(connectError.message || "Realtime connection failed.");
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
      } catch (socketInitError) {
        setError(socketInitError instanceof Error ? socketInitError.message : "Socket setup failed.");
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
    const readKey = `${selectedConversationId}:${newestMessage.id}`;
    if (lastReadEventRef.current === readKey) {
      return;
    }

    lastReadEventRef.current = readKey;
    socket.emit("chat:message_read", {
      conversationId: selectedConversationId,
      lastReadMessageId: newestMessage.id,
    });
  }, [messages, selectedConversationId, socketConnected]);

  return (
    <div className="min-h-screen bg-zinc-100 p-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <header className="flex items-center justify-between rounded-lg bg-white px-4 py-3 shadow-sm">
          <div>
            <h1 className="text-lg font-semibold text-zinc-900">Chat</h1>
            <p className="text-sm text-zinc-600">
              Signed in as {currentUser.username} ({currentUser.email})
            </p>
            <p className="text-xs text-zinc-500">
              Realtime: {socketConnected ? "connected" : "disconnected (REST fallback active)"}
            </p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Logout
          </button>
        </header>

        {error ? (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="grid min-h-[70vh] grid-cols-1 gap-4 md:grid-cols-[280px_1fr]">
          <aside className="rounded-lg bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-zinc-900">Conversations</h2>
            {loadingConversations ? <p className="text-sm text-zinc-600">Loading...</p> : null}

            {!loadingConversations && conversations.length === 0 ? (
              <p className="text-sm text-zinc-600">
                No conversations yet. Create one using `POST /api/conversations`.
              </p>
            ) : null}

            <div className="flex flex-col gap-2">
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => setSelectedConversationId(conversation.id)}
                  className={`rounded-md border px-3 py-2 text-left ${
                    conversation.id === selectedConversationId
                      ? "border-zinc-900 bg-zinc-900 text-white"
                      : "border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50"
                  }`}
                >
                  <p className="font-medium">{conversation.otherUser.username}</p>
                  <p className="truncate text-xs opacity-80">
                    {conversation.lastMessage?.textPreview ?? "No messages yet"}
                  </p>
                </button>
              ))}
            </div>
          </aside>

          <section className="flex flex-col rounded-lg bg-white p-4 shadow-sm">
            <div className="mb-3 border-b border-zinc-200 pb-3">
              <h2 className="text-base font-semibold text-zinc-900">
                {selectedConversation
                  ? `${selectedConversation.otherUser.username}`
                  : "Select a conversation"}
              </h2>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto pb-3">
              {loadingMessages ? <p className="text-sm text-zinc-600">Loading messages...</p> : null}

              {!loadingMessages && messages.length === 0 ? (
                <p className="text-sm text-zinc-600">No messages in this conversation yet.</p>
              ) : null}

              {nextCursor ? (
                <button
                  type="button"
                  onClick={() =>
                    selectedConversationId ? loadMessages(selectedConversationId, nextCursor) : null
                  }
                  className="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
                >
                  Load older messages
                </button>
              ) : null}

              {messages.map((message) => {
                const isCurrentUser = message.senderId === currentUser.id;

                return (
                  <div
                    key={message.id}
                    className={`max-w-xl rounded-md px-3 py-2 text-sm ${
                      isCurrentUser ? "ml-auto bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-900"
                    }`}
                  >
                    <p className="mb-1 text-xs opacity-80">
                      {message.sender.username} · {message.status}
                    </p>
                    <p>{message.text ?? message.imageKey ?? "[unsupported message]"}</p>
                    <p className="mt-1 text-xs opacity-70">
                      {new Date(message.createdAt).toLocaleString()}
                    </p>
                  </div>
                );
              })}
            </div>

            <form
              onSubmit={onSendMessage}
              className="mt-3 flex items-center gap-2 border-t border-zinc-200 pt-3"
            >
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Type a message"
                className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                disabled={!selectedConversationId || sendingMessage}
              />
              <button
                type="submit"
                disabled={!selectedConversationId || sendingMessage || !draft.trim()}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
              >
                {sendingMessage ? "Sending..." : "Send"}
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
