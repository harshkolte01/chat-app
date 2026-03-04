export type ChatMessageType = "TEXT" | "IMAGE";
export type ChatMessageStatus = "SENT" | "DELIVERED" | "READ";
export type IncomingChatMessageType = "text" | "image" | "TEXT" | "IMAGE";

export type SocketPublicUser = {
  id: string;
  username: string;
  email: string;
  createdAt: string;
};

export type SocketMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  type: ChatMessageType;
  text: string | null;
  imageKey: string | null;
  replyTo: SocketReplyMessage | null;
  status: ChatMessageStatus;
  createdAt: string;
};

export type SocketReplyMessage = {
  id: string;
  senderId: string;
  senderUsername: string;
  type: ChatMessageType;
  text: string | null;
  imageKey: string | null;
  createdAt: string;
};

export type SendMessagePayload = {
  conversationId: string;
  type: IncomingChatMessageType;
  text?: string;
  imageKey?: string;
  imageUrl?: string;
  replyToMessageId?: string;
  clientMessageId?: string;
};

export type MessageDeliveredPayload = {
  messageId: string;
};

export type MessageReadPayload = {
  conversationId: string;
  lastReadMessageId?: string;
  timestamp?: string;
};

export type SocketErrorPayload = {
  code: string;
  message: string;
};

export type SocketAckSuccess<T = unknown> = { ok: true; data?: T };
export type SocketAckError = { ok: false; error: SocketErrorPayload };
export type SocketAckResponse<T = unknown> = SocketAckSuccess<T> | SocketAckError;

export type SendMessageAckData = {
  message: SocketMessage;
  sender: SocketPublicUser;
  clientMessageId: string | null;
};

export type ChatNewMessageEvent = {
  message: SocketMessage;
  sender: SocketPublicUser;
  clientMessageId: string | null;
};

export type ChatMessageStatusUpdatedEvent = {
  conversationId: string;
  messageId: string;
  status: ChatMessageStatus;
};

export type ServerToClientEvents = {
  "chat:new_message": (payload: ChatNewMessageEvent) => void;
  "chat:message_status_updated": (payload: ChatMessageStatusUpdatedEvent) => void;
};

export type ClientToServerEvents = {
  "chat:send_message": (
    payload: SendMessagePayload,
    ack: (response: SocketAckResponse<SendMessageAckData>) => void,
  ) => void;
  "chat:message_delivered": (
    payload: MessageDeliveredPayload,
    ack?: (response: SocketAckResponse) => void,
  ) => void;
  "chat:message_read": (
    payload: MessageReadPayload,
    ack?: (response: SocketAckResponse<{ updatedCount: number }>) => void,
  ) => void;
};

export type SocketData = {
  user: SocketPublicUser;
};
