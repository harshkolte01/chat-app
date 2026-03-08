"use client";

import { useEffect, useRef, useState } from "react";
import type { CallMediaState, CallSessionSnapshot } from "@/lib/call-contracts";
import type {
  DesktopCallCapabilities,
  DesktopDisplaySource,
} from "@/lib/desktop-bridge";

type CallOverlayProps = {
  currentUserId: string;
  currentCall: CallSessionSnapshot | null;
  incomingCall: CallSessionSnapshot | null;
  localMediaState: CallMediaState;
  remoteMediaState: CallMediaState;
  localCameraStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  remoteCameraStream: MediaStream | null;
  remoteScreenStream: MediaStream | null;
  remoteAudioStream: MediaStream | null;
  socketConnected: boolean;
  callError: string | null;
  iceConnectionState: RTCIceConnectionState | null;
  isStartingCall: boolean;
  isAcceptingCall: boolean;
  screenSharePickerOpen: boolean;
  screenShareSources: DesktopDisplaySource[];
  screenShareSystemAudio: boolean;
  screenShareLoading: boolean;
  callCapabilities: DesktopCallCapabilities | null;
  onDismissCallError: () => void;
  onCloseScreenSharePicker: () => void;
  onSetScreenShareSystemAudio: (nextValue: boolean) => void;
  onAcceptIncomingCall: () => Promise<void>;
  onRejectIncomingCall: () => Promise<void>;
  onEndCurrentCall: () => Promise<void>;
  onToggleMic: () => Promise<void>;
  onToggleCamera: () => Promise<void>;
  onOpenScreenSharePicker: () => Promise<void>;
  onStartScreenShare: (sourceId: string) => Promise<void>;
  onStopScreenShare: () => Promise<void>;
};

function getCounterpart(call: CallSessionSnapshot, currentUserId: string) {
  return call.caller.id === currentUserId ? call.callee : call.caller;
}

function getCallStatusLabel(call: CallSessionSnapshot, currentUserId: string): string {
  if (call.status === "RINGING") {
    return call.caller.id === currentUserId ? "Calling..." : "Incoming call";
  }

  if (call.status === "ACTIVE") {
    return call.mode === "VIDEO" ? "Video call live" : "Voice call live";
  }

  return call.status.toLowerCase();
}

function ActionIcon({
  path,
  className = "h-5 w-5",
}: {
  path: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

function VideoSurface({
  stream,
  muted = false,
  mirrored = false,
  label,
  placeholder,
  accent,
}: {
  stream: MediaStream | null;
  muted?: boolean;
  mirrored?: boolean;
  label: string;
  placeholder: string;
  accent: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) {
      return;
    }

    videoElement.srcObject = stream;
    return () => {
      videoElement.srcObject = null;
    };
  }, [stream]);

  return (
    <div className="relative overflow-hidden rounded-[28px] border border-stone-200 bg-[#1b1711]">
      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          className={`h-full w-full object-cover ${mirrored ? "scale-x-[-1]" : ""}`}
        />
      ) : (
        <div className="flex h-full min-h-[220px] w-full items-center justify-center bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.24),rgba(23,18,12,0.96))] px-6 text-center">
          <div>
            <p className={`text-xs font-semibold uppercase tracking-[0.24em] ${accent}`}>{label}</p>
            <p className="mt-3 text-base font-medium text-white/85">{placeholder}</p>
          </div>
        </div>
      )}
      <div className="pointer-events-none absolute left-4 top-4 rounded-full border border-white/12 bg-black/45 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/85 backdrop-blur-sm">
        {label}
      </div>
    </div>
  );
}

function AudioSink({ stream }: { stream: MediaStream | null }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audioElement = audioRef.current;
    if (!audioElement) {
      return;
    }

    audioElement.srcObject = stream;
    return () => {
      audioElement.srcObject = null;
    };
  }, [stream]);

  return <audio ref={audioRef} autoPlay playsInline />;
}

function IceBadge({ state }: { state: RTCIceConnectionState | null }) {
  if (!state) return null;
  const map: Record<RTCIceConnectionState, { label: string; color: string }> = {
    new:          { label: "ICE: new",           color: "text-white/50" },
    checking:     { label: "ICE: checking…",     color: "text-amber-300" },
    connected:    { label: "ICE: connected",     color: "text-emerald-300" },
    completed:    { label: "ICE: completed",     color: "text-emerald-300" },
    disconnected: { label: "ICE: disconnected",  color: "text-rose-300" },
    failed:       { label: "ICE: failed",        color: "text-rose-400 font-bold" },
    closed:       { label: "ICE: closed",        color: "text-white/50" },
  };
  const entry = map[state];
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${entry.color}`}>
      {entry.label}
    </span>
  );
}

function MicTest() {
  const [active, setActive] = useState(false);
  const [level, setLevel] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const animRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  function stop() {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) t.stop();
    }
    streamRef.current = null;
    analyserRef.current = null;
    dataRef.current = null;
    setLevel(0);
    setActive(false);
  }

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      dataRef.current = new Uint8Array(analyser.frequencyBinCount);
      setActive(true);

      function tick() {
        if (!analyserRef.current || !dataRef.current) return;
        analyserRef.current.getByteFrequencyData(dataRef.current);
        const avg = dataRef.current.reduce((s, v) => s + v, 0) / dataRef.current.length;
        setLevel(Math.min(100, Math.round((avg / 128) * 100)));
        animRef.current = requestAnimationFrame(tick);
      }
      tick();
    } catch {
      stop();
    }
  }

  useEffect(() => () => stop(), []);

  return (
    <div className="rounded-[24px] border border-white/10 bg-black/18 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-200/85">Mic test</p>
      {active ? (
        <>
          <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-emerald-400 transition-all duration-75"
              style={{ width: `${level}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-white/55">
            {level === 0 ? "No signal — check mic permissions" : "Signal detected — mic is working"}
          </p>
          <button
            type="button"
            onClick={stop}
            className="mt-3 w-full rounded-2xl border border-white/12 bg-white/8 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/14"
          >
            Stop test
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => void start()}
          className="mt-3 w-full rounded-2xl border border-white/12 bg-white/8 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/14"
        >
          Test microphone
        </button>
      )}
    </div>
  );
}

function SourceTile({
  source,
  onSelect,
}: {
  source: DesktopDisplaySource;
  onSelect: (sourceId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(source.id)}
      className="group overflow-hidden rounded-[24px] border border-stone-200 bg-white text-left shadow-[0_18px_40px_rgba(17,17,17,0.08)] transition hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-[0_24px_50px_rgba(17,17,17,0.12)]"
    >
      <div className="relative aspect-video overflow-hidden bg-[#1f1911]">
        {source.thumbnailDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={source.thumbnailDataUrl}
            alt={source.name}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.24),rgba(23,18,12,0.96))] text-xs font-semibold uppercase tracking-[0.22em] text-white/80">
            Preview unavailable
          </div>
        )}
        <div className="absolute left-3 top-3 rounded-full border border-white/12 bg-black/45 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/90 backdrop-blur-sm">
          {source.kind}
        </div>
      </div>
      <div className="flex items-center gap-3 px-4 py-3">
        {source.appIconDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={source.appIconDataUrl}
            alt=""
            className="h-10 w-10 rounded-2xl border border-stone-200 bg-stone-100 object-cover"
          />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-stone-200 bg-stone-100 text-xs font-semibold uppercase tracking-[0.18em] text-black/55">
            {source.kind === "screen" ? "SC" : "WN"}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-black">{source.name}</p>
          <p className="mt-1 text-xs text-black/60">
            {source.kind === "screen" ? "Share an entire display" : "Share one window only"}
          </p>
        </div>
      </div>
    </button>
  );
}

export function CallOverlay(props: CallOverlayProps) {
  const {
    currentUserId,
    currentCall,
    incomingCall,
    localMediaState,
    remoteMediaState,
    localCameraStream,
    localScreenStream,
    remoteCameraStream,
    remoteScreenStream,
    remoteAudioStream,
    socketConnected,
    callError,
    iceConnectionState,
    isStartingCall,
    isAcceptingCall,
    screenSharePickerOpen,
    screenShareSources,
    screenShareSystemAudio,
    screenShareLoading,
    callCapabilities,
    onDismissCallError,
    onCloseScreenSharePicker,
    onSetScreenShareSystemAudio,
    onAcceptIncomingCall,
    onRejectIncomingCall,
    onEndCurrentCall,
    onToggleMic,
    onToggleCamera,
    onOpenScreenSharePicker,
    onStartScreenShare,
    onStopScreenShare,
  } = props;

  const activeCall = currentCall;
  const visibleCall = activeCall ?? incomingCall;
  const counterpart = visibleCall ? getCounterpart(visibleCall, currentUserId) : null;
  const localPreviewStream = localScreenStream ?? localCameraStream;
  const remoteStageStream = remoteScreenStream ?? remoteCameraStream;

  return (
    <>
      {remoteAudioStream ? <AudioSink stream={remoteAudioStream} /> : null}

      {incomingCall && !activeCall ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.15),rgba(0,0,0,0.62))] p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-[34px] border border-stone-200/80 bg-[#fffdf7] shadow-[0_40px_120px_rgba(17,17,17,0.34)]">
            <div className="border-b border-stone-200 bg-[linear-gradient(135deg,rgba(251,191,36,0.2),rgba(255,251,235,0.98))] px-6 py-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-800/80">
                Incoming {incomingCall.mode === "VIDEO" ? "video" : "voice"} call
              </p>
              <h3 className="mt-3 text-3xl font-semibold tracking-tight text-black">
                {counterpart?.username ?? "Unknown caller"}
              </h3>
              <p className="mt-2 text-sm leading-6 text-black/65">
                {incomingCall.mode === "VIDEO"
                  ? "Accept to join with camera and microphone. You can share your screen after the call connects."
                  : "Accept to join with your microphone. Video and screen sharing stay disabled for voice calls."}
              </p>
            </div>

            <div className="px-6 py-6">
              <div className="rounded-[28px] border border-stone-200 bg-[linear-gradient(180deg,rgba(255,246,214,0.74),rgba(255,255,255,0.96))] px-5 py-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-800/75">
                      Ready state
                    </p>
                    <p className="mt-2 text-sm text-black/70">
                      Signaling {socketConnected ? "connected" : "reconnecting"}
                    </p>
                  </div>
                  <div className="rounded-full border border-amber-300 bg-amber-100 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-amber-900">
                    {isAcceptingCall ? "Joining" : "Waiting"}
                  </div>
                </div>
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => void onRejectIncomingCall()}
                  className="flex-1 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900 transition hover:bg-rose-100"
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={() => void onAcceptIncomingCall()}
                  disabled={isAcceptingCall}
                  className="flex-1 rounded-2xl border border-emerald-300 bg-emerald-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-emerald-300"
                >
                  {isAcceptingCall ? "Joining..." : "Accept call"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeCall ? (
        <div className="fixed inset-0 z-[65] overflow-hidden bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.22),rgba(20,16,11,0.96))] text-white">
          <div className="absolute inset-0 opacity-60 [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:28px_28px]" />
          <div className="relative flex h-full flex-col px-4 pb-4 pt-4 sm:px-6 sm:pb-6 sm:pt-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-300/80">
                  {activeCall.mode === "VIDEO" ? "Desktop video call" : "Desktop voice call"}
                </p>
                <h3 className="mt-2 text-3xl font-semibold tracking-tight text-white">
                  {counterpart?.username ?? "Unknown participant"}
                </h3>
                <p className="mt-2 text-sm text-white/70">
                  {getCallStatusLabel(activeCall, currentUserId)}
                  {!socketConnected ? " • signaling reconnecting" : ""}
                </p>
                {iceConnectionState ? (
                  <p className="mt-1">
                    <IceBadge state={iceConnectionState} />
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-white/12 bg-white/8 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-white/80">
                  {activeCall.status}
                </span>
                <span className="rounded-full border border-white/12 bg-white/8 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-white/80">
                  {activeCall.mode}
                </span>
              </div>
            </div>

            <div className="mt-4 grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="grid min-h-0 gap-4">
                <div className="min-h-[320px] flex-1">
                  <VideoSurface
                    stream={remoteStageStream}
                    label={
                      remoteScreenStream
                        ? `${counterpart?.username ?? "Remote"} screen`
                        : `${counterpart?.username ?? "Remote"} video`
                    }
                    placeholder={
                      activeCall.status === "ACTIVE"
                        ? activeCall.mode === "VIDEO"
                          ? "Waiting for remote video or screen share."
                          : "Voice call active. No remote video stream is live."
                        : "Waiting for the other side to answer."
                    }
                    accent="text-amber-200"
                  />
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="h-[220px]">
                    <VideoSurface
                      stream={localPreviewStream}
                      muted
                      mirrored={!localScreenStream}
                      label={localScreenStream ? "Your screen" : "You"}
                      placeholder={
                        activeCall.mode === "VIDEO"
                          ? "Camera preview appears here once local video is active."
                          : "Voice call active. Your local preview stays disabled."
                      }
                      accent="text-amber-200"
                    />
                  </div>

                  <div className="h-[220px]">
                    <VideoSurface
                      stream={remoteScreenStream ? remoteCameraStream : null}
                      label={`${counterpart?.username ?? "Remote"} camera`}
                      placeholder="Camera preview switches here while the shared screen stays on the main stage."
                      accent="text-amber-200"
                    />
                  </div>
                </div>
              </div>

              <aside className="flex min-h-0 flex-col gap-4 rounded-[28px] border border-white/10 bg-white/8 p-4 shadow-[0_18px_42px_rgba(0,0,0,0.18)] backdrop-blur-md">
                <div className="rounded-[24px] border border-white/10 bg-black/18 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-200/85">
                    Live state
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-white/10 bg-white/8 px-3 py-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/55">
                        Your mic
                      </p>
                      <p className="mt-2 text-sm font-semibold text-white">
                        {localMediaState.micEnabled ? "Live" : "Muted"}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/8 px-3 py-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/55">
                        Remote mic
                      </p>
                      <p className="mt-2 text-sm font-semibold text-white">
                        {remoteMediaState.micEnabled ? "Live" : "Muted"}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/8 px-3 py-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/55">
                        Your video
                      </p>
                      <p className="mt-2 text-sm font-semibold text-white">
                        {localMediaState.cameraEnabled ? "On" : "Off"}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/8 px-3 py-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/55">
                        Remote share
                      </p>
                      <p className="mt-2 text-sm font-semibold text-white">
                        {remoteMediaState.screenSharing ? "Sharing" : "Idle"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-[24px] border border-white/10 bg-black/18 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-200/85">
                    Controls
                  </p>
                  <div className="mt-4 grid gap-3">
                    <button
                      type="button"
                      onClick={() => void onToggleMic()}
                      className="flex items-center justify-between rounded-2xl border border-white/12 bg-white/8 px-4 py-3 text-left transition hover:bg-white/12"
                    >
                      <span>
                        <span className="block text-sm font-semibold text-white">Microphone</span>
                        <span className="mt-1 block text-xs text-white/60">
                          {localMediaState.micEnabled ? "Mute yourself" : "Unmute yourself"}
                        </span>
                      </span>
                      <ActionIcon path="M12 2.5a3.5 3.5 0 0 1 3.5 3.5v5a3.5 3.5 0 0 1-7 0V6A3.5 3.5 0 0 1 12 2.5Zm0 0v14m-5-6a5 5 0 1 0 10 0m-7 10h4" />
                    </button>

                    {activeCall.mode === "VIDEO" ? (
                      <button
                        type="button"
                        onClick={() => void onToggleCamera()}
                        className="flex items-center justify-between rounded-2xl border border-white/12 bg-white/8 px-4 py-3 text-left transition hover:bg-white/12"
                      >
                        <span>
                          <span className="block text-sm font-semibold text-white">Camera</span>
                          <span className="mt-1 block text-xs text-white/60">
                            {localMediaState.cameraEnabled ? "Pause your camera" : "Resume your camera"}
                          </span>
                        </span>
                        <ActionIcon path="M3.5 7.5A2.5 2.5 0 0 1 6 5h8a2.5 2.5 0 0 1 2.5 2.5v1.1l4-2.7v12.2l-4-2.7v1.1A2.5 2.5 0 0 1 14 19H6a2.5 2.5 0 0 1-2.5-2.5Z" />
                      </button>
                    ) : null}

                    {activeCall.mode === "VIDEO" ? (
                      localMediaState.screenSharing ? (
                        <button
                          type="button"
                          onClick={() => void onStopScreenShare()}
                          className="flex items-center justify-between rounded-2xl border border-amber-300/30 bg-amber-500/15 px-4 py-3 text-left transition hover:bg-amber-500/22"
                        >
                          <span>
                            <span className="block text-sm font-semibold text-white">Stop screen share</span>
                            <span className="mt-1 block text-xs text-white/60">
                              {localMediaState.systemAudioSharing
                                ? "Screen and system audio are currently live."
                                : "Your display is live without system audio."}
                            </span>
                          </span>
                          <ActionIcon path="M4 5.5h16v10H4Zm4 13h8m-4-3v3" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void onOpenScreenSharePicker()}
                          className="flex items-center justify-between rounded-2xl border border-white/12 bg-white/8 px-4 py-3 text-left transition hover:bg-white/12"
                        >
                          <span>
                            <span className="block text-sm font-semibold text-white">Share screen</span>
                            <span className="mt-1 block text-xs text-white/60">
                              {callCapabilities?.systemAudioSharingSupported
                                ? "Choose a display and optionally include system audio."
                                : "Choose a display to share."}
                            </span>
                          </span>
                          <ActionIcon path="M4 5.5h16v10H4Zm4 13h8m-4-3v3" />
                        </button>
                      )
                    ) : null}

                    <button
                      type="button"
                      onClick={() => void onEndCurrentCall()}
                      className="flex items-center justify-between rounded-2xl border border-rose-400/40 bg-rose-500/18 px-4 py-3 text-left transition hover:bg-rose-500/26"
                    >
                      <span>
                        <span className="block text-sm font-semibold text-white">End call</span>
                        <span className="mt-1 block text-xs text-white/60">
                          Hang up for both participants immediately.
                        </span>
                      </span>
                      <ActionIcon path="M4.5 9.5c4.4-4.2 10.6-4.2 15 0l-2.3 3.1a1.5 1.5 0 0 1-2 .4l-2.2-1.1a1.5 1.5 0 0 0-1.3 0l-2.2 1.1a1.5 1.5 0 0 1-2-.4Z" />
                    </button>
                  </div>
                </div>

                <MicTest />
              </aside>
            </div>

            {isStartingCall ? (
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/8 px-4 py-3 text-sm text-white/75 backdrop-blur-md">
                Preparing local devices and placing the call...
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {screenSharePickerOpen ? (
        <div className="fixed inset-0 z-[75] overflow-y-auto bg-black/55 p-3 backdrop-blur-sm sm:p-6">
          <div className="mx-auto max-w-6xl">
            <div className="overflow-hidden rounded-[34px] border border-stone-200/80 bg-[#fffdf7] shadow-[0_40px_120px_rgba(17,17,17,0.28)]">
              <div className="border-b border-stone-200 bg-[linear-gradient(135deg,rgba(251,191,36,0.22),rgba(255,251,235,0.98))] px-5 py-5 sm:px-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-800/80">
                      Share screen
                    </p>
                    <h3 className="mt-2 text-3xl font-semibold tracking-tight text-black">
                      Choose what you want to present
                    </h3>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-black/65">
                      Pick one display or app window. The active screen becomes the main stream for the
                      other participant while your camera stays available separately.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onCloseScreenSharePicker}
                    className="rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-stone-100"
                  >
                    Close
                  </button>
                </div>
              </div>

              <div className="px-5 py-5 sm:px-6 sm:py-6">
                {callCapabilities?.systemAudioSharingSupported ? (
                  <label className="mb-6 flex items-center gap-3 rounded-[24px] border border-stone-200 bg-white px-4 py-4 shadow-[0_14px_34px_rgba(17,17,17,0.05)]">
                    <input
                      type="checkbox"
                      checked={screenShareSystemAudio}
                      onChange={(event) => onSetScreenShareSystemAudio(event.target.checked)}
                      className="h-4 w-4 rounded border-stone-300 text-amber-600 focus:ring-amber-500"
                    />
                    <div>
                      <p className="text-sm font-semibold text-black">Include system audio</p>
                      <p className="mt-1 text-xs leading-5 text-black/60">
                        Share Windows playback audio with your screen stream.
                      </p>
                    </div>
                  </label>
                ) : null}

                {screenShareLoading ? (
                  <div className="rounded-[28px] border border-dashed border-stone-300 bg-stone-50 px-6 py-16 text-center text-sm text-black/65">
                    Loading display sources...
                  </div>
                ) : null}

                {!screenShareLoading && screenShareSources.length === 0 ? (
                  <div className="rounded-[28px] border border-dashed border-stone-300 bg-stone-50 px-6 py-16 text-center text-sm text-black/65">
                    No screen or window sources were returned by the desktop bridge.
                  </div>
                ) : null}

                {!screenShareLoading && screenShareSources.length > 0 ? (
                  <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                    {screenShareSources.map((source) => (
                      <SourceTile
                        key={source.id}
                        source={source}
                        onSelect={(sourceId) => void onStartScreenShare(sourceId)}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {callError ? (
        <div className="fixed bottom-4 right-4 z-[80] max-w-sm rounded-[24px] border border-rose-200 bg-[#fff7f7] px-4 py-4 text-black shadow-[0_24px_56px_rgba(17,17,17,0.18)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-rose-700/80">
                Calling
              </p>
              <p className="mt-2 text-sm leading-6 text-black/75">{callError}</p>
            </div>
            <button
              type="button"
              onClick={onDismissCallError}
              className="rounded-xl border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-stone-100"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
