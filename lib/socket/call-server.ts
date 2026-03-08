import { Server as SocketIOServer, Socket } from "socket.io";
import {
  CallAckData,
  CallMediaState,
  CallMode,
  CallSessionSnapshot,
  CallSignalMessage,
  CallStatus,
  createDefaultCallMediaState,
  createInactiveCallMediaState,
  normalizeCallMediaState,
} from "../call-contracts";
import { getConversationForMember } from "../chat/read-state";
import { prisma } from "../db";
import {
  ClientToServerEvents,
  ServerToClientEvents,
  SocketAckResponse,
  SocketData,
  SocketErrorPayload,
} from "./contracts";

type SocketServer = SocketIOServer<ClientToServerEvents, ServerToClientEvents, object, SocketData>;
type AuthenticatedSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  object,
  SocketData
>;

type PersistedCallRecord = {
  id: string;
  conversationId: string;
  callerId: string;
  calleeId: string;
  mode: CallMode;
  status: CallStatus;
  failureReason: string | null;
  answeredAt: Date | null;
  endedAt: Date | null;
  endedById: string | null;
  createdAt: Date;
  caller: {
    id: string;
    username: string;
    email: string;
    createdAt: Date;
  };
  callee: {
    id: string;
    username: string;
    email: string;
    createdAt: Date;
  };
};

type CallMediaStateStore = {
  caller: CallMediaState;
  callee: CallMediaState;
};

const callSessionSelect = {
  id: true,
  conversationId: true,
  callerId: true,
  calleeId: true,
  mode: true,
  status: true,
  failureReason: true,
  answeredAt: true,
  endedAt: true,
  endedById: true,
  createdAt: true,
  caller: {
    select: {
      id: true,
      username: true,
      email: true,
      createdAt: true,
    },
  },
  callee: {
    select: {
      id: true,
      username: true,
      email: true,
      createdAt: true,
    },
  },
} as const;

const OPEN_CALL_STATUSES: CallStatus[] = ["RINGING", "ACTIVE"];
const pendingCallTimeouts = new Map<string, NodeJS.Timeout>();
const callMediaStates = new Map<string, CallMediaStateStore>();
let hasRestoredPendingCalls = false;

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

const CALL_RING_TIMEOUT_MS = parsePositiveInteger(process.env.CALL_RING_TIMEOUT_MS, 45_000);

function createSocketError(code: string, message: string): SocketErrorPayload {
  return { code, message };
}

function ackSuccess<T>(ack: ((response: SocketAckResponse<T>) => void) | undefined, data?: T) {
  if (!ack) {
    return;
  }

  if (data === undefined) {
    ack({ ok: true } as SocketAckResponse<T>);
    return;
  }

  ack({ ok: true, data });
}

function ackError<T>(
  ack: ((response: SocketAckResponse<T>) => void) | undefined,
  code: string,
  message: string,
) {
  if (!ack) {
    return;
  }

  ack({
    ok: false,
    error: createSocketError(code, message),
  });
}

function userRoom(userId: string): string {
  return `user:${userId}`;
}

function normalizeCallMode(value: unknown): CallMode | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "AUDIO" || normalized === "VIDEO") {
    return normalized;
  }

  return null;
}

function toDefaultMediaStateStore(call: Pick<PersistedCallRecord, "mode" | "status">): CallMediaStateStore {
  return {
    caller: createDefaultCallMediaState(call.mode),
    callee: call.status === "ACTIVE" ? createDefaultCallMediaState(call.mode) : createInactiveCallMediaState(),
  };
}

function getCallMediaStateStore(call: PersistedCallRecord): CallMediaStateStore {
  const existing = callMediaStates.get(call.id);
  if (existing) {
    return existing;
  }

  const defaults = toDefaultMediaStateStore(call);
  callMediaStates.set(call.id, defaults);
  return defaults;
}

function clearPendingCallTimeout(callId: string) {
  const timer = pendingCallTimeouts.get(callId);
  if (!timer) {
    return;
  }

  clearTimeout(timer);
  pendingCallTimeouts.delete(callId);
}

function clearCallRuntimeState(callId: string) {
  clearPendingCallTimeout(callId);
  callMediaStates.delete(callId);
}

function toCallSessionSnapshot(call: PersistedCallRecord): CallSessionSnapshot {
  const mediaState = getCallMediaStateStore(call);

  return {
    id: call.id,
    conversationId: call.conversationId,
    caller: {
      id: call.caller.id,
      username: call.caller.username,
      email: call.caller.email,
      createdAt: call.caller.createdAt.toISOString(),
    },
    callee: {
      id: call.callee.id,
      username: call.callee.username,
      email: call.callee.email,
      createdAt: call.callee.createdAt.toISOString(),
    },
    mode: call.mode,
    status: call.status,
    createdAt: call.createdAt.toISOString(),
    answeredAt: call.answeredAt ? call.answeredAt.toISOString() : null,
    endedAt: call.endedAt ? call.endedAt.toISOString() : null,
    endedById: call.endedById,
    failureReason: call.failureReason,
    callerMediaState: mediaState.caller,
    calleeMediaState: mediaState.callee,
  };
}

async function loadCallById(callId: string): Promise<PersistedCallRecord | null> {
  return prisma.callSession.findUnique({
    where: { id: callId },
    select: callSessionSelect,
  }) as Promise<PersistedCallRecord | null>;
}

async function listOpenCallsForUser(userId: string): Promise<PersistedCallRecord[]> {
  return prisma.callSession.findMany({
    where: {
      status: {
        in: OPEN_CALL_STATUSES,
      },
      OR: [{ callerId: userId }, { calleeId: userId }],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: callSessionSelect,
  }) as Promise<PersistedCallRecord[]>;
}

async function hasBusyUser(userIds: string[]): Promise<boolean> {
  const busyCall = await prisma.callSession.findFirst({
    where: {
      status: {
        in: OPEN_CALL_STATUSES,
      },
      OR: userIds.flatMap((userId) => [{ callerId: userId }, { calleeId: userId }]),
    },
    select: {
      id: true,
    },
  });

  return Boolean(busyCall);
}

function emitCallState(io: SocketServer, call: PersistedCallRecord) {
  const payload = {
    call: toCallSessionSnapshot(call),
  };

  io.to(userRoom(call.callerId)).emit("call:state_changed", payload);
  io.to(userRoom(call.calleeId)).emit("call:state_changed", payload);
}

function scheduleCallTimeout(io: SocketServer, call: PersistedCallRecord) {
  clearPendingCallTimeout(call.id);

  const remainingMs = CALL_RING_TIMEOUT_MS - (Date.now() - call.createdAt.getTime());
  if (remainingMs <= 0) {
    void expireRingingCall(io, call.id);
    return;
  }

  const timer = setTimeout(() => {
    void expireRingingCall(io, call.id);
  }, remainingMs);

  pendingCallTimeouts.set(call.id, timer);
}

async function expireRingingCall(io: SocketServer, callId: string) {
  clearPendingCallTimeout(callId);

  const updateResult = await prisma.callSession.updateMany({
    where: {
      id: callId,
      status: "RINGING",
    },
    data: {
      status: "MISSED",
      failureReason: "No answer",
      endedAt: new Date(),
    },
  });

  if (updateResult.count === 0) {
    return;
  }

  const call = await loadCallById(callId);
  if (!call) {
    clearCallRuntimeState(callId);
    return;
  }

  emitCallState(io, call);
  clearCallRuntimeState(callId);
}

async function restorePendingCallTimeouts(io: SocketServer) {
  if (hasRestoredPendingCalls) {
    return;
  }

  hasRestoredPendingCalls = true;

  const ringingCalls = (await prisma.callSession.findMany({
    where: {
      status: "RINGING",
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: callSessionSelect,
  })) as PersistedCallRecord[];

  for (const call of ringingCalls) {
    scheduleCallTimeout(io, call);
  }
}

function validateCallSignal(signal: unknown): CallSignalMessage | null {
  if (!signal || typeof signal !== "object") {
    return null;
  }

  const candidateSignal = signal as Partial<CallSignalMessage>;
  if (candidateSignal.kind === "description") {
    const description = candidateSignal.description;
    if (
      description &&
      (description.type === "offer" || description.type === "answer") &&
      typeof description.sdp === "string" &&
      description.sdp.trim()
    ) {
      return {
        kind: "description",
        description: {
          type: description.type,
          sdp: description.sdp,
        },
      };
    }

    return null;
  }

  if (candidateSignal.kind === "ice_candidate") {
    const candidate = candidateSignal.candidate;
    if (
      candidate &&
      typeof candidate.candidate === "string" &&
      candidate.candidate.trim()
    ) {
      return {
        kind: "ice_candidate",
        candidate: {
          candidate: candidate.candidate,
          sdpMid: typeof candidate.sdpMid === "string" ? candidate.sdpMid : null,
          sdpMLineIndex:
            typeof candidate.sdpMLineIndex === "number" ? candidate.sdpMLineIndex : null,
          usernameFragment:
            typeof candidate.usernameFragment === "string" ? candidate.usernameFragment : null,
        },
      };
    }
  }

  return null;
}

async function handleStartCall(
  io: SocketServer,
  socket: AuthenticatedSocket,
  payload: { conversationId?: string; mode?: unknown },
  ack: (response: SocketAckResponse<{ call: CallSessionSnapshot }>) => void,
) {
  const caller = socket.data.user;
  const conversationId = payload.conversationId?.trim();
  const mode = normalizeCallMode(payload.mode);

  if (!conversationId || !mode) {
    return ackError(ack, "INVALID_PAYLOAD", "conversationId and mode are required.");
  }

  const conversation = await getConversationForMember(conversationId, caller.id);
  if (!conversation) {
    return ackError(ack, "FORBIDDEN", "You are not allowed to call in this conversation.");
  }

  const calleeId = conversation.userAId === caller.id ? conversation.userBId : conversation.userAId;
  if (await hasBusyUser([caller.id, calleeId])) {
    return ackError(
      ack,
      "CALL_BUSY",
      "One of the participants is already in another call.",
    );
  }

  const call = (await prisma.callSession.create({
    data: {
      conversationId,
      callerId: caller.id,
      calleeId,
      mode,
      status: "RINGING",
    },
    select: callSessionSelect,
  })) as PersistedCallRecord;

  callMediaStates.set(call.id, {
    caller: createDefaultCallMediaState(mode),
    callee: createInactiveCallMediaState(),
  });

  scheduleCallTimeout(io, call);

  const snapshot = toCallSessionSnapshot(call);
  io.to(userRoom(calleeId)).emit("call:incoming", { call: snapshot });
  io.to(userRoom(caller.id)).emit("call:state_changed", { call: snapshot });

  ackSuccess(ack, { call: snapshot });
}

async function handleAcceptCall(
  io: SocketServer,
  socket: AuthenticatedSocket,
  callId: string,
  ack?: (response: SocketAckResponse<CallAckData>) => void,
) {
  const currentUserId = socket.data.user.id;
  const existingCall = await loadCallById(callId);
  if (!existingCall) {
    return ackError(ack, "CALL_NOT_FOUND", "Call not found.");
  }

  if (existingCall.calleeId !== currentUserId) {
    return ackError(ack, "FORBIDDEN", "Only the callee can accept this call.");
  }

  if (existingCall.status !== "RINGING") {
    return ackError(ack, "INVALID_STATE", "Only a ringing call can be accepted.");
  }

  clearPendingCallTimeout(callId);

  const updatedCall = (await prisma.callSession.update({
    where: { id: callId },
    data: {
      status: "ACTIVE",
      answeredAt: new Date(),
      failureReason: null,
    },
    select: callSessionSelect,
  })) as PersistedCallRecord;

  const currentMediaState = getCallMediaStateStore(updatedCall);
  callMediaStates.set(updatedCall.id, {
    caller: currentMediaState.caller,
    callee: createDefaultCallMediaState(updatedCall.mode),
  });

  emitCallState(io, updatedCall);
  ackSuccess(ack, { call: toCallSessionSnapshot(updatedCall) });
}

async function transitionCallToTerminalState(
  io: SocketServer,
  socket: AuthenticatedSocket,
  params: {
    callId: string;
    nextStatus: Exclude<CallStatus, "RINGING" | "ACTIVE">;
    requireCaller?: boolean;
    requireCallee?: boolean;
    allowStatuses: CallStatus[];
    failureReason?: string | null;
  },
  ack?: (response: SocketAckResponse<CallAckData>) => void,
) {
  const currentUserId = socket.data.user.id;
  const existingCall = await loadCallById(params.callId);
  if (!existingCall) {
    return ackError(ack, "CALL_NOT_FOUND", "Call not found.");
  }

  if (
    currentUserId !== existingCall.callerId &&
    currentUserId !== existingCall.calleeId
  ) {
    return ackError(ack, "FORBIDDEN", "Not a participant in this call.");
  }

  if (params.requireCaller && currentUserId !== existingCall.callerId) {
    return ackError(ack, "FORBIDDEN", "Only the caller can perform this action.");
  }

  if (params.requireCallee && currentUserId !== existingCall.calleeId) {
    return ackError(ack, "FORBIDDEN", "Only the callee can perform this action.");
  }

  if (!params.allowStatuses.includes(existingCall.status)) {
    return ackError(ack, "INVALID_STATE", "The call is no longer in a valid state.");
  }

  const updatedCall = (await prisma.callSession.update({
    where: { id: params.callId },
    data: {
      status: params.nextStatus,
      endedAt: new Date(),
      endedById: currentUserId,
      failureReason: params.failureReason ?? null,
    },
    select: callSessionSelect,
  })) as PersistedCallRecord;

  const snapshot = toCallSessionSnapshot(updatedCall);
  emitCallState(io, updatedCall);
  clearCallRuntimeState(params.callId);

  ackSuccess(ack, { call: snapshot });
}

async function handleCallSignal(
  io: SocketServer,
  socket: AuthenticatedSocket,
  payload: { callId?: string; signal?: unknown },
  ack?: (response: SocketAckResponse) => void,
) {
  const currentUserId = socket.data.user.id;
  const callId = payload.callId?.trim();
  if (!callId) {
    return ackError(ack, "INVALID_PAYLOAD", "callId is required.");
  }

  const signal = validateCallSignal(payload.signal);
  if (!signal) {
    return ackError(ack, "INVALID_PAYLOAD", "signal is invalid.");
  }

  const call = await loadCallById(callId);
  if (!call) {
    return ackError(ack, "CALL_NOT_FOUND", "Call not found.");
  }

  if (call.status !== "ACTIVE") {
    return ackError(ack, "INVALID_STATE", "Signaling is only allowed for active calls.");
  }

  if (currentUserId !== call.callerId && currentUserId !== call.calleeId) {
    return ackError(ack, "FORBIDDEN", "Not a participant in this call.");
  }

  const targetUserId = currentUserId === call.callerId ? call.calleeId : call.callerId;
  io.to(userRoom(targetUserId)).emit("call:signal", {
    callId,
    fromUserId: currentUserId,
    signal,
  });

  ackSuccess(ack);
}

async function handleCallMediaState(
  io: SocketServer,
  socket: AuthenticatedSocket,
  payload: { callId?: string; mediaState?: Partial<CallMediaState> | null },
  ack?: (response: SocketAckResponse<CallAckData>) => void,
) {
  const currentUserId = socket.data.user.id;
  const callId = payload.callId?.trim();
  if (!callId) {
    return ackError(ack, "INVALID_PAYLOAD", "callId is required.");
  }

  const call = await loadCallById(callId);
  if (!call) {
    return ackError(ack, "CALL_NOT_FOUND", "Call not found.");
  }

  if (!OPEN_CALL_STATUSES.includes(call.status)) {
    return ackError(ack, "INVALID_STATE", "The call is no longer active.");
  }

  if (currentUserId !== call.callerId && currentUserId !== call.calleeId) {
    return ackError(ack, "FORBIDDEN", "Not a participant in this call.");
  }

  const nextMediaState = normalizeCallMediaState(payload.mediaState);
  if (!nextMediaState.screenSharing) {
    nextMediaState.systemAudioSharing = false;
  }

  const currentState = getCallMediaStateStore(call);
  const updatedState =
    currentUserId === call.callerId
      ? {
          caller: nextMediaState,
          callee: currentState.callee,
        }
      : {
          caller: currentState.caller,
          callee: nextMediaState,
        };

  callMediaStates.set(call.id, updatedState);

  const targetUserId = currentUserId === call.callerId ? call.calleeId : call.callerId;
  io.to(userRoom(targetUserId)).emit("call:media_state", {
    callId: call.id,
    userId: currentUserId,
    mediaState: nextMediaState,
  });

  ackSuccess(ack, { call: toCallSessionSnapshot(call) });
}

async function emitCallSyncState(socket: AuthenticatedSocket) {
  const calls = await listOpenCallsForUser(socket.data.user.id);
  socket.emit("call:sync_state", {
    calls: calls.map((call) => toCallSessionSnapshot(call)),
  });
}

export function initializeCallSocketServer(io: SocketServer) {
  void restorePendingCallTimeouts(io);
}

export function registerCallConnectionHandlers(io: SocketServer, socket: AuthenticatedSocket) {
  void emitCallSyncState(socket);

  socket.on("call:start", async (payload, ack) => {
    try {
      await handleStartCall(io, socket, payload, ack);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to start the call.";
      ackError(ack, "CALL_START_FAILED", message);
    }
  });

  socket.on("call:accept", async (payload, ack) => {
    try {
      await handleAcceptCall(io, socket, payload.callId?.trim() ?? "", ack);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to accept the call.";
      ackError(ack, "CALL_ACCEPT_FAILED", message);
    }
  });

  socket.on("call:reject", async (payload, ack) => {
    try {
      await transitionCallToTerminalState(
        io,
        socket,
        {
          callId: payload.callId?.trim() ?? "",
          nextStatus: "REJECTED",
          requireCallee: true,
          allowStatuses: ["RINGING"],
        },
        ack,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to reject the call.";
      ackError(ack, "CALL_REJECT_FAILED", message);
    }
  });

  socket.on("call:cancel", async (payload, ack) => {
    try {
      await transitionCallToTerminalState(
        io,
        socket,
        {
          callId: payload.callId?.trim() ?? "",
          nextStatus: "CANCELED",
          requireCaller: true,
          allowStatuses: ["RINGING"],
        },
        ack,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to cancel the call.";
      ackError(ack, "CALL_CANCEL_FAILED", message);
    }
  });

  socket.on("call:hangup", async (payload, ack) => {
    try {
      await transitionCallToTerminalState(
        io,
        socket,
        {
          callId: payload.callId?.trim() ?? "",
          nextStatus: "ENDED",
          allowStatuses: ["ACTIVE"],
        },
        ack,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to end the call.";
      ackError(ack, "CALL_END_FAILED", message);
    }
  });

  socket.on("call:signal", async (payload, ack) => {
    try {
      await handleCallSignal(io, socket, payload, ack);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to forward call signal.";
      ackError(ack, "CALL_SIGNAL_FAILED", message);
    }
  });

  socket.on("call:media_state", async (payload, ack) => {
    try {
      await handleCallMediaState(io, socket, payload, ack);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update media state.";
      ackError(ack, "CALL_MEDIA_STATE_FAILED", message);
    }
  });
}

export function destroyCallSocketServer() {
  for (const callId of pendingCallTimeouts.keys()) {
    clearPendingCallTimeout(callId);
  }

  callMediaStates.clear();
  hasRestoredPendingCalls = false;
}
