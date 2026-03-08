export type CallMode = "AUDIO" | "VIDEO";
export type CallStatus =
  | "RINGING"
  | "ACTIVE"
  | "REJECTED"
  | "MISSED"
  | "CANCELED"
  | "ENDED"
  | "FAILED";

export type CallPublicUser = {
  id: string;
  username: string;
  email: string;
  createdAt: string;
};

export type CallMediaState = {
  micEnabled: boolean;
  cameraEnabled: boolean;
  screenSharing: boolean;
  systemAudioSharing: boolean;
};

export type CallSessionSnapshot = {
  id: string;
  conversationId: string;
  caller: CallPublicUser;
  callee: CallPublicUser;
  mode: CallMode;
  status: CallStatus;
  createdAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  endedById: string | null;
  failureReason: string | null;
  callerMediaState: CallMediaState;
  calleeMediaState: CallMediaState;
};

export type StartCallPayload = {
  conversationId: string;
  mode: CallMode;
};

export type CallActionPayload = {
  callId: string;
};

export type CallSignalDescription = {
  type: "offer" | "answer";
  sdp: string;
};

export type CallSignalIceCandidate = {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment: string | null;
};

export type CallSignalMessage =
  | {
      kind: "description";
      description: CallSignalDescription;
    }
  | {
      kind: "ice_candidate";
      candidate: CallSignalIceCandidate;
    };

export type CallSignalPayload = {
  callId: string;
  signal: CallSignalMessage;
};

export type CallMediaStatePayload = {
  callId: string;
  mediaState: CallMediaState;
};

export type StartCallAckData = {
  call: CallSessionSnapshot;
};

export type CallAckData = {
  call: CallSessionSnapshot;
};

export type CallIncomingEvent = {
  call: CallSessionSnapshot;
};

export type CallStateChangedEvent = {
  call: CallSessionSnapshot;
};

export type CallSignalEvent = {
  callId: string;
  fromUserId: string;
  signal: CallSignalMessage;
};

export type CallMediaStateEvent = {
  callId: string;
  userId: string;
  mediaState: CallMediaState;
};

export type CallSyncStateEvent = {
  calls: CallSessionSnapshot[];
};

export function createDefaultCallMediaState(mode: CallMode): CallMediaState {
  return {
    micEnabled: true,
    cameraEnabled: mode === "VIDEO",
    screenSharing: false,
    systemAudioSharing: false,
  };
}

export function createInactiveCallMediaState(): CallMediaState {
  return {
    micEnabled: false,
    cameraEnabled: false,
    screenSharing: false,
    systemAudioSharing: false,
  };
}

export function normalizeCallMediaState(value: Partial<CallMediaState> | null | undefined): CallMediaState {
  return {
    micEnabled: value?.micEnabled !== false,
    cameraEnabled: value?.cameraEnabled === true,
    screenSharing: value?.screenSharing === true,
    systemAudioSharing: value?.systemAudioSharing === true,
  };
}

export function isTerminalCallStatus(status: CallStatus): boolean {
  return (
    status === "REJECTED" ||
    status === "MISSED" ||
    status === "CANCELED" ||
    status === "ENDED" ||
    status === "FAILED"
  );
}
