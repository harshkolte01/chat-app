"use client";

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import type { Socket } from "socket.io-client";
import type { PublicUser } from "@/lib/auth/current-user";
import { getWebRtcIceServers } from "@/lib/call-config";
import {
  CallActionPayload,
  CallMediaState,
  CallSessionSnapshot,
  CallSignalIceCandidate,
  CallSignalMessage,
  CallStateChangedEvent,
  CallSyncStateEvent,
  createInactiveCallMediaState,
  isTerminalCallStatus,
} from "@/lib/call-contracts";
import {
  DesktopCallCapabilities,
  DesktopDisplaySource,
  getDesktopBridge,
} from "@/lib/desktop-bridge";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SocketAckResponse,
} from "@/lib/socket/contracts";

type SocketClient = Socket<ServerToClientEvents, ClientToServerEvents>;

type SelectedConversation = {
  id: string;
  otherUser: PublicUser;
} | null;

type SenderBundle = {
  voice: RTCRtpSender | null;
  camera: RTCRtpSender | null;
  screen: RTCRtpSender | null;
  systemAudio: RTCRtpSender | null;
};

type UseDesktopCallControllerOptions = {
  currentUser: PublicUser;
  selectedConversation: SelectedConversation;
  socket: SocketClient | null;
  socketConnected: boolean;
  desktopShell: boolean;
};

export type DesktopCallController = {
  canCall: boolean;
  availabilityMessage: string | null;
  currentCall: CallSessionSnapshot | null;
  incomingCall: CallSessionSnapshot | null;
  callError: string | null;
  isStartingCall: boolean;
  isAcceptingCall: boolean;
  localMediaState: CallMediaState;
  remoteMediaState: CallMediaState;
  localCameraStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  remoteCameraStream: MediaStream | null;
  remoteScreenStream: MediaStream | null;
  remoteAudioStream: MediaStream | null;
  screenSharePickerOpen: boolean;
  screenShareSources: DesktopDisplaySource[];
  screenShareSystemAudio: boolean;
  screenShareLoading: boolean;
  callCapabilities: DesktopCallCapabilities | null;
  iceConnectionState: RTCIceConnectionState | null;
  dismissCallError: () => void;
  closeScreenSharePicker: () => void;
  setScreenShareSystemAudio: (nextValue: boolean) => void;
  startAudioCall: () => Promise<void>;
  startVideoCall: () => Promise<void>;
  acceptIncomingCall: () => Promise<void>;
  rejectIncomingCall: () => Promise<void>;
  endCurrentCall: () => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  openScreenSharePicker: () => Promise<void>;
  startScreenShare: (sourceId: string) => Promise<void>;
  stopScreenShare: () => Promise<void>;
};

function getParticipantMediaState(
  call: CallSessionSnapshot,
  currentUserId: string,
): CallMediaState {
  return call.caller.id === currentUserId ? call.callerMediaState : call.calleeMediaState;
}

function getRemoteParticipantMediaState(
  call: CallSessionSnapshot,
  currentUserId: string,
): CallMediaState {
  return call.caller.id === currentUserId ? call.calleeMediaState : call.callerMediaState;
}

function updateCallSnapshotMediaState(
  call: CallSessionSnapshot,
  userId: string,
  mediaState: CallMediaState,
): CallSessionSnapshot {
  if (call.caller.id === userId) {
    return {
      ...call,
      callerMediaState: mediaState,
    };
  }

  return {
    ...call,
    calleeMediaState: mediaState,
  };
}

function stopMediaStream(stream: MediaStream | null) {
  if (!stream) {
    return;
  }

  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function serializeIceCandidate(candidate: RTCIceCandidate): CallSignalIceCandidate {
  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid,
    sdpMLineIndex: candidate.sdpMLineIndex,
    usernameFragment: candidate.usernameFragment ?? null,
  };
}

export function useDesktopCallController(
  options: UseDesktopCallControllerOptions,
): DesktopCallController {
  const { currentUser, selectedConversation, socket, socketConnected, desktopShell } = options;

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const senderBundleRef = useRef<SenderBundle>({
    voice: null,
    camera: null,
    screen: null,
    systemAudio: null,
  });
  const currentCallRef = useRef<CallSessionSnapshot | null>(null);
  const incomingCallRef = useRef<CallSessionSnapshot | null>(null);
  const knownCallsRef = useRef<Map<string, CallSessionSnapshot>>(new Map());
  const localMediaStateRef = useRef<CallMediaState>(createInactiveCallMediaState());
  const localBaseStreamRef = useRef<MediaStream | null>(null);
  const localScreenStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioStreamRef = useRef<MediaStream | null>(null);
  const currentPeerCallIdRef = useRef<string | null>(null);
  const offerStartedForCallIdRef = useRef<string | null>(null);

  const [currentCall, setCurrentCall] = useState<CallSessionSnapshot | null>(null);
  const [incomingCall, setIncomingCall] = useState<CallSessionSnapshot | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const [isStartingCall, setIsStartingCall] = useState(false);
  const [isAcceptingCall, setIsAcceptingCall] = useState(false);
  const [callCapabilities, setCallCapabilities] = useState<DesktopCallCapabilities | null>(null);
  const [screenSharePickerOpen, setScreenSharePickerOpen] = useState(false);
  const [screenShareSources, setScreenShareSources] = useState<DesktopDisplaySource[]>([]);
  const [screenShareSystemAudio, setScreenShareSystemAudio] = useState(true);
  const [screenShareLoading, setScreenShareLoading] = useState(false);
  const [localMediaState, setLocalMediaState] = useState<CallMediaState>(createInactiveCallMediaState());
  const [remoteMediaState, setRemoteMediaState] = useState<CallMediaState>(createInactiveCallMediaState());
  const [localCameraStream, setLocalCameraStream] = useState<MediaStream | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [remoteCameraStream, setRemoteCameraStream] = useState<MediaStream | null>(null);
  const [remoteScreenStream, setRemoteScreenStream] = useState<MediaStream | null>(null);
  const [remoteAudioStream, setRemoteAudioStream] = useState<MediaStream | null>(null);
  const [iceConnectionState, setIceConnectionState] = useState<RTCIceConnectionState | null>(null);

  const canCall = desktopShell && Boolean(selectedConversation) && !currentCall && !incomingCall;
  const availabilityMessage = !desktopShell
    ? "Desktop calling is only available in the desktop app."
    : !socketConnected
      ? "Calling is unavailable until the realtime server reconnects."
      : null;

  function syncKnownCall(nextCall: CallSessionSnapshot | null) {
    if (!nextCall) {
      return;
    }

    knownCallsRef.current.set(nextCall.id, nextCall);
  }

  function removeKnownCall(callId: string) {
    knownCallsRef.current.delete(callId);
  }

  function setCurrentCallState(nextCall: CallSessionSnapshot | null) {
    currentCallRef.current = nextCall;
    syncKnownCall(nextCall);
    setCurrentCall(nextCall);
  }

  function setIncomingCallState(nextCall: CallSessionSnapshot | null) {
    incomingCallRef.current = nextCall;
    syncKnownCall(nextCall);
    setIncomingCall(nextCall);
  }

  function setLocalMediaStateWithSnapshot(nextState: CallMediaState) {
    localMediaStateRef.current = nextState;
    setLocalMediaState(nextState);
    setCurrentCall((previous) => {
      if (!previous) {
        return previous;
      }

      const nextCall = updateCallSnapshotMediaState(previous, currentUser.id, nextState);
      currentCallRef.current = nextCall;
      syncKnownCall(nextCall);
      return nextCall;
    });
  }

  function setRemoteCameraTrack(track: MediaStreamTrack | null) {
    setRemoteCameraStream(track ? new MediaStream([track]) : null);
  }

  function setRemoteScreenTrack(track: MediaStreamTrack | null) {
    setRemoteScreenStream(track ? new MediaStream([track]) : null);
  }

  function resetRemoteMediaStreams() {
    remoteAudioStreamRef.current = null;
    setRemoteAudioStream(null);
    setRemoteCameraStream(null);
    setRemoteScreenStream(null);
  }

  function ensureRemoteAudioStream(): MediaStream {
    if (remoteAudioStreamRef.current) {
      return remoteAudioStreamRef.current;
    }

    const stream = new MediaStream();
    remoteAudioStreamRef.current = stream;
    setRemoteAudioStream(stream);
    return stream;
  }

  function applyMediaStateSnapshot(call: CallSessionSnapshot) {
    setLocalMediaStateWithSnapshot(getParticipantMediaState(call, currentUser.id));
    setRemoteMediaState(getRemoteParticipantMediaState(call, currentUser.id));
  }

  async function emitCallStart(
    conversationId: string,
    mode: "AUDIO" | "VIDEO",
  ): Promise<SocketAckResponse<{ call: CallSessionSnapshot }>> {
    if (!socket) {
      return {
        ok: false,
        error: {
          code: "SOCKET_UNAVAILABLE",
          message: "Calling is currently unavailable.",
        },
      };
    }

    return new Promise((resolve) => {
      socket.emit("call:start", { conversationId, mode }, resolve);
    });
  }

  async function emitCallAction(
    eventName: "call:accept" | "call:reject" | "call:cancel" | "call:hangup",
    payload: CallActionPayload,
  ): Promise<SocketAckResponse<{ call: CallSessionSnapshot }>> {
    if (!socket) {
      return {
        ok: false,
        error: {
          code: "SOCKET_UNAVAILABLE",
          message: "Calling is currently unavailable.",
        },
      };
    }

    return new Promise((resolve) => {
      socket.emit(eventName, payload, resolve);
    });
  }

  async function emitCallSignal(
    callId: string,
    signal: CallSignalMessage,
  ): Promise<SocketAckResponse> {
    if (!socket) {
      return {
        ok: false,
        error: {
          code: "SOCKET_UNAVAILABLE",
          message: "Calling is currently unavailable.",
        },
      };
    }

    return new Promise((resolve) => {
      socket.emit("call:signal", { callId, signal }, resolve);
    });
  }

  async function emitCallMediaState(
    callId: string,
    mediaState: CallMediaState,
  ): Promise<SocketAckResponse<{ call: CallSessionSnapshot }>> {
    if (!socket) {
      return {
        ok: false,
        error: {
          code: "SOCKET_UNAVAILABLE",
          message: "Calling is currently unavailable.",
        },
      };
    }

    return new Promise((resolve) => {
      socket.emit("call:media_state", { callId, mediaState }, resolve);
    });
  }

  function syncLocalPreviewStreams() {
    const cameraTrack = localBaseStreamRef.current?.getVideoTracks()[0] ?? null;
    setLocalCameraStream(cameraTrack ? new MediaStream([cameraTrack]) : null);

    const screenTrack = localScreenStreamRef.current?.getVideoTracks()[0] ?? null;
    setLocalScreenStream(screenTrack ? new MediaStream([screenTrack]) : null);
  }

  async function syncPeerConnectionTracks() {
    const senderBundle = senderBundleRef.current;
    if (
      !senderBundle.voice &&
      !senderBundle.camera &&
      !senderBundle.screen &&
      !senderBundle.systemAudio
    ) {
      return;
    }

    const baseStream = localBaseStreamRef.current;
    const screenStream = localScreenStreamRef.current;

    await Promise.all([
      senderBundle.voice?.replaceTrack(baseStream?.getAudioTracks()[0] ?? null) ?? Promise.resolve(),
      senderBundle.camera?.replaceTrack(baseStream?.getVideoTracks()[0] ?? null) ?? Promise.resolve(),
      senderBundle.screen?.replaceTrack(screenStream?.getVideoTracks()[0] ?? null) ?? Promise.resolve(),
      senderBundle.systemAudio?.replaceTrack(screenStream?.getAudioTracks()[0] ?? null) ??
        Promise.resolve(),
    ]);
  }

  async function teardownCallMedia() {
    const existingPeerConnection = peerConnectionRef.current;
    if (existingPeerConnection) {
      existingPeerConnection.onicecandidate = null;
      existingPeerConnection.ontrack = null;
      existingPeerConnection.onconnectionstatechange = null;
      existingPeerConnection.oniceconnectionstatechange = null;
      existingPeerConnection.close();
      peerConnectionRef.current = null;
    }

    senderBundleRef.current = {
      voice: null,
      camera: null,
      screen: null,
      systemAudio: null,
    };
    currentPeerCallIdRef.current = null;
    offerStartedForCallIdRef.current = null;

    stopMediaStream(localBaseStreamRef.current);
    stopMediaStream(localScreenStreamRef.current);
    localBaseStreamRef.current = null;
    localScreenStreamRef.current = null;

    setLocalCameraStream(null);
    setLocalScreenStream(null);
    resetRemoteMediaStreams();
    setLocalMediaStateWithSnapshot(createInactiveCallMediaState());
    setRemoteMediaState(createInactiveCallMediaState());
    setScreenSharePickerOpen(false);
    setScreenShareSources([]);
    setIceConnectionState(null);
  }

  async function captureLocalMedia(mode: "AUDIO" | "VIDEO") {
    stopMediaStream(localBaseStreamRef.current);
    localBaseStreamRef.current = null;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video:
        mode === "VIDEO"
          ? {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30, max: 30 },
            }
          : false,
    });

    const audioTrack = stream.getAudioTracks()[0] ?? null;
    const videoTrack = stream.getVideoTracks()[0] ?? null;
    if (audioTrack) {
      audioTrack.enabled = true;
    }
    if (videoTrack) {
      videoTrack.enabled = true;
    }

    localBaseStreamRef.current = stream;
    syncLocalPreviewStreams();

    const nextMediaState = {
      micEnabled: Boolean(audioTrack),
      cameraEnabled: Boolean(videoTrack),
      screenSharing: false,
      systemAudioSharing: false,
    };
    setLocalMediaStateWithSnapshot(nextMediaState);

    return nextMediaState;
  }

  async function ensurePeerConnection(call: CallSessionSnapshot) {
    if (
      peerConnectionRef.current &&
      currentPeerCallIdRef.current === call.id
    ) {
      return peerConnectionRef.current;
    }

    if (peerConnectionRef.current) {
      await teardownCallMedia();
      const nextState = getParticipantMediaState(call, currentUser.id);
      setLocalMediaStateWithSnapshot(nextState);
      setRemoteMediaState(getRemoteParticipantMediaState(call, currentUser.id));
    }

    resetRemoteMediaStreams();

    const peerConnection = new RTCPeerConnection({
      iceServers: getWebRtcIceServers(),
      iceCandidatePoolSize: 2,
    });
    currentPeerCallIdRef.current = call.id;

    const transceivers = [
      peerConnection.addTransceiver("audio", { direction: "sendrecv" }),
      peerConnection.addTransceiver("video", { direction: "sendrecv" }),
      peerConnection.addTransceiver("video", { direction: "sendrecv" }),
      peerConnection.addTransceiver("audio", { direction: "sendrecv" }),
    ];

    senderBundleRef.current = {
      voice: transceivers[0].sender,
      camera: transceivers[1].sender,
      screen: transceivers[2].sender,
      systemAudio: transceivers[3].sender,
    };

    peerConnection.onicecandidate = (event) => {
      if (!event.candidate || !currentCallRef.current) {
        return;
      }

      void emitCallSignal(currentCallRef.current.id, {
        kind: "ice_candidate",
        candidate: serializeIceCandidate(event.candidate),
      });
    };

    peerConnection.ontrack = (event) => {
      const transceiverIndex = peerConnection.getTransceivers().indexOf(event.transceiver);
      const remoteTrack = event.track;

      if (transceiverIndex === 0 || transceiverIndex === 3) {
        const audioStream = ensureRemoteAudioStream();
        if (!audioStream.getTracks().some((track) => track.id === remoteTrack.id)) {
          audioStream.addTrack(remoteTrack);
          setRemoteAudioStream(audioStream);
        }

        remoteTrack.addEventListener("ended", () => {
          if (!remoteAudioStreamRef.current) {
            return;
          }

          for (const track of remoteAudioStreamRef.current.getTracks()) {
            if (track.id === remoteTrack.id) {
              remoteAudioStreamRef.current.removeTrack(track);
            }
          }

          if (remoteAudioStreamRef.current.getTracks().length === 0) {
            remoteAudioStreamRef.current = null;
            setRemoteAudioStream(null);
          }
        });

        return;
      }

      if (transceiverIndex === 1) {
        setRemoteCameraTrack(remoteTrack);
        remoteTrack.addEventListener("ended", () => {
          setRemoteCameraTrack(null);
        });
        return;
      }

      if (transceiverIndex === 2) {
        setRemoteScreenTrack(remoteTrack);
        remoteTrack.addEventListener("ended", () => {
          setRemoteScreenTrack(null);
        });
      }
    };

    peerConnection.onconnectionstatechange = () => {
      if (peerConnection.connectionState === "failed") {
        setCallError("The media connection failed. End the call and try again.");
      }
    };

    peerConnection.oniceconnectionstatechange = () => {
      setIceConnectionState(peerConnection.iceConnectionState);
    };

    peerConnectionRef.current = peerConnection;
    await syncPeerConnectionTracks();

    return peerConnection;
  }

  const handleCallStateChanged = useEffectEvent(async (payload: CallStateChangedEvent) => {
    const { call } = payload;
    syncKnownCall(call);

    if (call.status === "RINGING") {
      if (call.callee.id === currentUser.id) {
        setIncomingCallState(call);
        applyMediaStateSnapshot(call);

        const desktop = getDesktopBridge();
        if (desktop) {
          void desktop.showNotification({
            title: `${call.caller.username} is calling`,
            body: call.mode === "VIDEO" ? "Incoming video call" : "Incoming voice call",
            conversationId: call.conversationId,
          });
          void desktop.flashWindow();
        }
      } else if (call.caller.id === currentUser.id) {
        setCurrentCallState(call);
        applyMediaStateSnapshot(call);
      }

      return;
    }

    if (call.status === "ACTIVE") {
      if (incomingCallRef.current?.id === call.id) {
        setIncomingCallState(null);
      }
      setCurrentCallState(call);
      applyMediaStateSnapshot(call);

      const desktop = getDesktopBridge();
      if (desktop) {
        void desktop.stopFlashWindow();
      }

      if (call.caller.id === currentUser.id && offerStartedForCallIdRef.current !== call.id) {
        offerStartedForCallIdRef.current = call.id;
        const peerConnection = await ensurePeerConnection(call);
        await syncPeerConnectionTracks();
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        await emitCallSignal(call.id, {
          kind: "description",
          description: {
            type: "offer",
            sdp: offer.sdp ?? "",
          },
        });
        void emitCallMediaState(call.id, localMediaStateRef.current);
      }

      return;
    }

    if (isTerminalCallStatus(call.status)) {
      const wasCurrentCall = currentCallRef.current?.id === call.id;
      const wasIncomingCall = incomingCallRef.current?.id === call.id;

      if (!wasCurrentCall && !wasIncomingCall) {
        return;
      }

      if (wasCurrentCall) {
        setCurrentCallState(call);
      }
      if (wasIncomingCall) {
        setIncomingCallState(null);
      }
      await teardownCallMedia();

      const desktop = getDesktopBridge();
      if (desktop) {
        void desktop.stopFlashWindow();
      }

      if (call.failureReason) {
        setCallError(call.failureReason);
      }

      window.setTimeout(() => {
        if (currentCallRef.current?.id === call.id) {
          setCurrentCallState(null);
        }
        if (incomingCallRef.current?.id === call.id) {
          setIncomingCallState(null);
        }
        removeKnownCall(call.id);
      }, 1_000);
    }
  });

  const handleCallSignal = useEffectEvent(async (payload: {
    callId: string;
    signal: CallSignalMessage;
  }) => {
    const activeCall =
      currentCallRef.current?.id === payload.callId
        ? currentCallRef.current
        : incomingCallRef.current?.id === payload.callId
          ? incomingCallRef.current
          : knownCallsRef.current.get(payload.callId) ?? null;
    if (!activeCall) {
      return;
    }

    const peerConnection = await ensurePeerConnection(activeCall);

    if (payload.signal.kind === "description") {
      const description = new RTCSessionDescription(payload.signal.description);
      await peerConnection.setRemoteDescription(description);

      if (payload.signal.description.type === "offer") {
        await syncPeerConnectionTracks();
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        await emitCallSignal(activeCall.id, {
          kind: "description",
          description: {
            type: "answer",
            sdp: answer.sdp ?? "",
          },
        });
        void emitCallMediaState(activeCall.id, localMediaStateRef.current);
      }

      return;
    }

    await peerConnection.addIceCandidate(new RTCIceCandidate(payload.signal.candidate));
  });

  const handleRemoteMediaState = useEffectEvent((payload: {
    callId: string;
    userId: string;
    mediaState: CallMediaState;
  }) => {
    if (payload.userId === currentUser.id) {
      return;
    }

    if (currentCallRef.current?.id !== payload.callId) {
      return;
    }

    setRemoteMediaState(payload.mediaState);
    setCurrentCall((previous) => {
      if (!previous || previous.id !== payload.callId) {
        return previous;
      }

      const nextCall = updateCallSnapshotMediaState(previous, payload.userId, payload.mediaState);
      currentCallRef.current = nextCall;
      syncKnownCall(nextCall);
      return nextCall;
    });
  });

  const handleCallSyncState = useEffectEvent((payload: CallSyncStateEvent) => {
    const nextCall = payload.calls[0] ?? null;
    if (!nextCall) {
      return;
    }

    if (nextCall.status === "RINGING" && nextCall.callee.id === currentUser.id) {
      setIncomingCallState(nextCall);
      applyMediaStateSnapshot(nextCall);
      return;
    }

    setCurrentCallState(nextCall);
    applyMediaStateSnapshot(nextCall);
  });

  const handleUnmount = useEffectEvent(() => {
    void teardownCallMedia();
  });

  useEffect(() => {
    localMediaStateRef.current = localMediaState;
  }, [localMediaState]);

  useEffect(() => {
    if (!desktopShell) {
      return;
    }

    const desktop = getDesktopBridge();
    if (!desktop) {
      return;
    }

    let cancelled = false;

    void desktop
      .getCallCapabilities()
      .then((nextCapabilities) => {
        if (cancelled) {
          return;
        }

        setCallCapabilities(nextCapabilities);
        setScreenShareSystemAudio(nextCapabilities.systemAudioSharingSupported);
      })
      .catch(() => {
        if (!cancelled) {
          setCallCapabilities(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [desktopShell]);

  useEffect(() => {
    if (!socket) {
      return;
    }

    socket.on("call:incoming", handleCallStateChanged);
    socket.on("call:state_changed", handleCallStateChanged);
    socket.on("call:signal", handleCallSignal);
    socket.on("call:media_state", handleRemoteMediaState);
    socket.on("call:sync_state", handleCallSyncState);

    return () => {
      socket.off("call:incoming", handleCallStateChanged);
      socket.off("call:state_changed", handleCallStateChanged);
      socket.off("call:signal", handleCallSignal);
      socket.off("call:media_state", handleRemoteMediaState);
      socket.off("call:sync_state", handleCallSyncState);
    };
  }, [socket]);

  useEffect(() => {
    return () => {
      handleUnmount();
    };
  }, []);

  async function startCall(mode: "AUDIO" | "VIDEO") {
    if (!desktopShell) {
      setCallError("Desktop calling is only available in the desktop app.");
      return;
    }

    if (!selectedConversation) {
      setCallError("Select a conversation before starting a call.");
      return;
    }

    if (!socketConnected) {
      setCallError("Calling is unavailable until the realtime server reconnects.");
      return;
    }

    setIsStartingCall(true);
    setCallError(null);

    try {
      await teardownCallMedia();
      const nextLocalState = await captureLocalMedia(mode);
      const response = await emitCallStart(selectedConversation.id, mode);
      if (!response.ok || !response.data) {
        throw new Error(response.ok ? "Failed to start the call." : response.error.message);
      }

      const nextCall = updateCallSnapshotMediaState(response.data.call, currentUser.id, nextLocalState);
      setIncomingCallState(null);
      setCurrentCallState(nextCall);
      setRemoteMediaState(getRemoteParticipantMediaState(nextCall, currentUser.id));
    } catch (error) {
      await teardownCallMedia();
      setCallError(error instanceof Error ? error.message : "Failed to start the call.");
    } finally {
      setIsStartingCall(false);
    }
  }

  async function acceptIncomingCall() {
    const nextIncomingCall = incomingCallRef.current;
    if (!nextIncomingCall) {
      return;
    }

    setIsAcceptingCall(true);
    setCallError(null);

    try {
      await teardownCallMedia();
      const nextLocalState = await captureLocalMedia(nextIncomingCall.mode);
      const response = await emitCallAction("call:accept", { callId: nextIncomingCall.id });
      if (!response.ok || !response.data) {
        throw new Error(response.ok ? "Failed to accept the call." : response.error.message);
      }

      const activeCall = updateCallSnapshotMediaState(response.data.call, currentUser.id, nextLocalState);
      setIncomingCallState(null);
      setCurrentCallState(activeCall);
      setRemoteMediaState(getRemoteParticipantMediaState(activeCall, currentUser.id));
      await ensurePeerConnection(activeCall);
      await syncPeerConnectionTracks();
      void emitCallMediaState(activeCall.id, nextLocalState);
    } catch (error) {
      await teardownCallMedia();
      setCallError(error instanceof Error ? error.message : "Failed to accept the call.");
    } finally {
      setIsAcceptingCall(false);
    }
  }

  async function rejectIncomingCall() {
    const nextIncomingCall = incomingCallRef.current;
    if (!nextIncomingCall) {
      return;
    }

    setCallError(null);
    const response = await emitCallAction("call:reject", { callId: nextIncomingCall.id });
    if (!response.ok) {
      setCallError(response.error.message);
    }
  }

  async function endCurrentCall() {
    if (incomingCallRef.current?.status === "RINGING") {
      await rejectIncomingCall();
      return;
    }

    const activeCall = currentCallRef.current;
    if (!activeCall) {
      return;
    }

    setCallError(null);

    const eventName =
      activeCall.status === "RINGING" && activeCall.caller.id === currentUser.id
        ? "call:cancel"
        : "call:hangup";
    const response = await emitCallAction(eventName, { callId: activeCall.id });
    if (!response.ok) {
      setCallError(response.error.message);
    }
  }

  async function toggleMic() {
    const audioTrack = localBaseStreamRef.current?.getAudioTracks()[0] ?? null;
    const activeCall = currentCallRef.current;
    if (!audioTrack || !activeCall) {
      return;
    }

    audioTrack.enabled = !audioTrack.enabled;
    const nextState = {
      ...localMediaStateRef.current,
      micEnabled: audioTrack.enabled,
    };
    setLocalMediaStateWithSnapshot(nextState);
    const response = await emitCallMediaState(activeCall.id, nextState);
    if (!response.ok) {
      setCallError(response.error.message);
    }
  }

  async function toggleCamera() {
    const activeCall = currentCallRef.current;
    const videoTrack = localBaseStreamRef.current?.getVideoTracks()[0] ?? null;
    if (!activeCall || !videoTrack) {
      return;
    }

    videoTrack.enabled = !videoTrack.enabled;
    syncLocalPreviewStreams();
    const nextState = {
      ...localMediaStateRef.current,
      cameraEnabled: videoTrack.enabled,
    };
    setLocalMediaStateWithSnapshot(nextState);
    const response = await emitCallMediaState(activeCall.id, nextState);
    if (!response.ok) {
      setCallError(response.error.message);
    }
  }

  async function openScreenSharePicker() {
    const activeCall = currentCallRef.current;
    if (!activeCall || activeCall.mode !== "VIDEO") {
      return;
    }

    const desktop = getDesktopBridge();
    if (!desktop) {
      setCallError("Screen sharing is only available in the desktop app.");
      return;
    }

    setScreenShareLoading(true);
    setCallError(null);

    try {
      const [sources, nextCapabilities] = await Promise.all([
        desktop.listDisplaySources(),
        desktop.getCallCapabilities(),
      ]);

      setCallCapabilities(nextCapabilities);
      setScreenShareSystemAudio(nextCapabilities.systemAudioSharingSupported);
      setScreenShareSources(sources);
      setScreenSharePickerOpen(true);
    } catch (error) {
      setCallError(error instanceof Error ? error.message : "Failed to load screen share sources.");
    } finally {
      setScreenShareLoading(false);
    }
  }

  async function stopScreenShare(emitState = true) {
    const activeCall = currentCallRef.current;
    if (!localScreenStreamRef.current) {
      return;
    }

    stopMediaStream(localScreenStreamRef.current);
    localScreenStreamRef.current = null;
    syncLocalPreviewStreams();
    await syncPeerConnectionTracks();

    const nextState = {
      ...localMediaStateRef.current,
      screenSharing: false,
      systemAudioSharing: false,
    };
    setLocalMediaStateWithSnapshot(nextState);

    if (emitState && activeCall) {
      const response = await emitCallMediaState(activeCall.id, nextState);
      if (!response.ok) {
        setCallError(response.error.message);
      }
    }
  }

  async function startScreenShare(sourceId: string) {
    const activeCall = currentCallRef.current;
    if (!activeCall || activeCall.mode !== "VIDEO") {
      return;
    }

    const desktop = getDesktopBridge();
    if (!desktop) {
      setCallError("Screen sharing is only available in the desktop app.");
      return;
    }

    setCallError(null);

    try {
      await desktop.prepareScreenShare({
        sourceId,
        includeSystemAudio:
          screenShareSystemAudio && Boolean(callCapabilities?.systemAudioSharingSupported),
      });

      if (localScreenStreamRef.current) {
        await stopScreenShare(false);
      }

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 30, max: 30 },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: screenShareSystemAudio && Boolean(callCapabilities?.systemAudioSharingSupported),
      });
      const screenTrack = stream.getVideoTracks()[0] ?? null;
      if (!screenTrack) {
        stopMediaStream(stream);
        throw new Error("No screen video track was captured.");
      }

      localScreenStreamRef.current = stream;
      syncLocalPreviewStreams();
      screenTrack.addEventListener("ended", () => {
        void stopScreenShare();
      });

      await syncPeerConnectionTracks();

      const nextState = {
        ...localMediaStateRef.current,
        screenSharing: true,
        systemAudioSharing: stream.getAudioTracks().length > 0,
      };
      setLocalMediaStateWithSnapshot(nextState);
      const response = await emitCallMediaState(activeCall.id, nextState);
      if (!response.ok) {
        setCallError(response.error.message);
      }

      setScreenSharePickerOpen(false);
      setScreenShareSources([]);
    } catch (error) {
      setCallError(error instanceof Error ? error.message : "Failed to start screen sharing.");
    }
  }

  return {
    canCall,
    availabilityMessage,
    currentCall,
    incomingCall,
    callError,
    isStartingCall,
    isAcceptingCall,
    localMediaState,
    remoteMediaState,
    localCameraStream,
    localScreenStream,
    remoteCameraStream,
    remoteScreenStream,
    remoteAudioStream,
    screenSharePickerOpen,
    screenShareSources,
    screenShareSystemAudio,
    screenShareLoading,
    callCapabilities,
    iceConnectionState,
    dismissCallError: () => setCallError(null),
    closeScreenSharePicker: () => setScreenSharePickerOpen(false),
    setScreenShareSystemAudio,
    startAudioCall: () => startCall("AUDIO"),
    startVideoCall: () => startCall("VIDEO"),
    acceptIncomingCall,
    rejectIncomingCall,
    endCurrentCall,
    toggleMic,
    toggleCamera,
    openScreenSharePicker,
    startScreenShare,
    stopScreenShare: () => stopScreenShare(true),
  };
}
