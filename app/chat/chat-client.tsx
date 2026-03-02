"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PublicUser } from "@/lib/auth/current-user";

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
  message: Message;
};

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

export function ChatClient({ currentUser }: { currentUser: PublicUser }) {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
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

  async function onSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedConversationId || !draft.trim() || sendingMessage) {
      return;
    }

    setSendingMessage(true);
    setError(null);

    try {
      await fetchJson<SendMessageResponse>("/api/messages/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversationId: selectedConversationId,
          text: draft.trim(),
        }),
      });

      setDraft("");
      await Promise.all([loadMessages(selectedConversationId), loadConversations()]);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Failed to send message.");
    } finally {
      setSendingMessage(false);
    }
  }

  async function onLogout() {
    try {
      await fetchJson("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (!selectedConversationId) {
      return;
    }

    void loadMessages(selectedConversationId);
  }, [loadMessages, selectedConversationId]);

  return (
    <div className="min-h-screen bg-zinc-100 p-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <header className="flex items-center justify-between rounded-lg bg-white px-4 py-3 shadow-sm">
          <div>
            <h1 className="text-lg font-semibold text-zinc-900">Chat</h1>
            <p className="text-sm text-zinc-600">
              Signed in as {currentUser.username} ({currentUser.email})
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
                    <p className="mb-1 text-xs opacity-80">{message.sender.username}</p>
                    <p>{message.text ?? message.imageKey ?? "[unsupported message]"}</p>
                    <p className="mt-1 text-xs opacity-70">
                      {new Date(message.createdAt).toLocaleString()}
                    </p>
                  </div>
                );
              })}
            </div>

            <form onSubmit={onSendMessage} className="mt-3 flex items-center gap-2 border-t border-zinc-200 pt-3">
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
