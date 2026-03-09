"use client";

import { FormEvent, startTransition, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChatClient } from "@/app/chat/chat-client";
import { BrandMark } from "@/components/BrandMark";
import { PublicUser } from "@/lib/auth/current-user";
import {
  clearStoredPinUnlockToken,
  hasStoredPinUnlockToken,
  PIN_LOCK_EVENT_NAME,
  storePinUnlockToken,
} from "@/lib/auth/pin-client";

type PinSetupResponse = {
  pinConfigured: true;
  pinUnlockToken: string;
};

type PinVerifyResponse = {
  pinConfigured: true;
  pinUnlockToken: string;
};

type ChatAccessGateProps = {
  currentUser: PublicUser;
  pinConfigured: boolean;
};

const PIN_LENGTH = 6;

function sanitizePinValue(value: string): string {
  return value.replace(/\D+/g, "").slice(0, PIN_LENGTH);
}

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      (payload as { error?: { message?: string } } | null)?.error?.message ?? "Request failed.",
    );
  }

  return payload as T;
}

function LockGlyph() {
  return (
    <div className="relative flex h-16 w-16 items-center justify-center rounded-[24px] border border-amber-300/80 bg-[linear-gradient(180deg,rgba(255,247,219,0.98),rgba(251,191,36,0.28))] shadow-[0_20px_40px_rgba(180,83,9,0.18)]">
      <div className="absolute inset-0 rounded-[24px] border border-white/60" />
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="h-7 w-7 text-amber-900"
      >
        <path d="M7.75 10.25V8.5a4.25 4.25 0 1 1 8.5 0v1.75" />
        <rect x="5.5" y="10.25" width="13" height="9.5" rx="2.5" />
        <path d="M12 14.25v2.25" />
      </svg>
    </div>
  );
}

export function ChatAccessGate({
  currentUser,
  pinConfigured: initialPinConfigured,
}: ChatAccessGateProps) {
  const router = useRouter();
  const [pinConfigured, setPinConfigured] = useState(initialPinConfigured);
  const [isHydrated, setIsHydrated] = useState(!initialPinConfigured);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!initialPinConfigured) {
      return;
    }

    setIsHydrated(true);
    setIsUnlocked(hasStoredPinUnlockToken());
  }, [initialPinConfigured]);

  useEffect(() => {
    const handlePinLock = () => {
      clearStoredPinUnlockToken();
      setError(null);
      setPin("");
      setConfirmPin("");
      setIsUnlocked(false);
      setIsHydrated(true);
    };

    window.addEventListener(PIN_LOCK_EVENT_NAME, handlePinLock);
    return () => {
      window.removeEventListener(PIN_LOCK_EVENT_NAME, handlePinLock);
    };
  }, []);

  async function handleSetupSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }

    if (pin.length !== PIN_LENGTH || confirmPin.length !== PIN_LENGTH) {
      setError("Enter a 6-digit PIN in both fields.");
      return;
    }

    if (pin !== confirmPin) {
      setError("PIN and re-enter PIN must match.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await postJson<PinSetupResponse>("/api/auth/pin/setup", {
        pin,
        confirmPin,
      });
      storePinUnlockToken(response.pinUnlockToken);
      setPinConfigured(true);
      setIsUnlocked(true);
      setPin("");
      setConfirmPin("");
    } catch (setupError) {
      setError(setupError instanceof Error ? setupError.message : "Unable to set up PIN.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUnlockSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }

    if (pin.length !== PIN_LENGTH) {
      setError("Enter your 6-digit PIN.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await postJson<PinVerifyResponse>("/api/auth/pin/verify", {
        pin,
      });
      storePinUnlockToken(response.pinUnlockToken);
      setIsUnlocked(true);
      setPin("");
    } catch (unlockError) {
      setError(unlockError instanceof Error ? unlockError.message : "Unable to verify PIN.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    if (submitting) {
      return;
    }

    setSubmitting(true);
    clearStoredPinUnlockToken();

    try {
      await fetch("/api/auth/logout", {
        method: "POST",
      });
    } finally {
      startTransition(() => {
        router.push("/login");
        router.refresh();
      });
      setSubmitting(false);
    }
  }

  if (pinConfigured && isHydrated && isUnlocked) {
    return <ChatClient currentUser={currentUser} />;
  }

  const isSetupFlow = !pinConfigured;
  const headline = isSetupFlow ? "Setup your PIN" : "Enter your PIN";
  const bodyCopy = isSetupFlow
    ? "Create a six-digit lock code before SecretChat opens your conversations on this device."
    : "This account is still logged in. Enter your six-digit PIN to unlock chats and the interface.";
  const submitLabel = isSetupFlow
    ? submitting
      ? "Setting up..."
      : "Setup"
    : submitting
      ? "Unlocking..."
      : "Unlock";

  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.24),_transparent_36%),linear-gradient(180deg,#fffaf0_0%,#f4ede0_50%,#efe7d7_100%)] px-4 py-6 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 opacity-50">
        <div className="absolute left-[-8%] top-[8%] h-52 w-52 rounded-full bg-amber-200/40 blur-3xl" />
        <div className="absolute right-[-6%] top-[24%] h-64 w-64 rounded-full bg-stone-300/35 blur-3xl" />
        <div className="absolute bottom-[-8%] left-[14%] h-72 w-72 rounded-full bg-amber-100/40 blur-3xl" />
      </div>

      <section className="relative mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-6xl items-center justify-center">
        <div className="grid w-full gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="hidden rounded-[34px] border border-white/70 bg-[linear-gradient(160deg,rgba(255,255,255,0.78),rgba(255,250,238,0.64))] p-8 shadow-[0_30px_80px_rgba(17,17,17,0.08)] backdrop-blur md:block lg:p-10">
            <BrandMark subtitle="Private messaging with a second local lock." />
            <div className="mt-10 space-y-5">
              <p className="inline-flex rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-800">
                Session shield
              </p>
              <h1 className="max-w-lg text-4xl font-semibold leading-tight tracking-[-0.03em] text-black">
                Chat stays signed in, but the workspace still locks when the tab or app closes.
              </h1>
              <p className="max-w-xl text-base leading-7 text-black/68">
                SecretChat now uses a two-step gate: your account session remains available, and a
                separate six-digit PIN re-opens the interface each time you return.
              </p>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              <div className="rounded-[26px] border border-stone-200/80 bg-white/78 p-5 shadow-[0_12px_32px_rgba(17,17,17,0.05)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-black/42">
                  Account
                </p>
                <p className="mt-3 text-xl font-semibold text-black">{currentUser.username}</p>
                <p className="mt-1 break-all text-sm text-black/62">{currentUser.email}</p>
              </div>

              <div className="rounded-[26px] border border-stone-200/80 bg-white/78 p-5 shadow-[0_12px_32px_rgba(17,17,17,0.05)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-black/42">
                  Rule
                </p>
                <p className="mt-3 text-sm leading-7 text-black/68">
                  Numbers only. Six digits. Every fresh tab or desktop launch asks again.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-[34px] border border-stone-200/90 bg-[linear-gradient(180deg,rgba(255,253,248,0.97),rgba(255,248,232,0.95))] p-5 shadow-[0_28px_80px_rgba(17,17,17,0.12)] backdrop-blur sm:p-7 lg:p-8">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-4">
                <LockGlyph />
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-800/80">
                    Secure access
                  </p>
                  <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-black sm:text-[2.2rem]">
                    {headline}
                  </h2>
                  <p className="mt-3 max-w-lg text-sm leading-7 text-black/66">{bodyCopy}</p>
                </div>
              </div>
            </div>

            {error ? (
              <div className="mt-6 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            ) : null}

            {pinConfigured && !isHydrated ? (
              <div className="mt-8 rounded-[28px] border border-stone-200 bg-white/82 p-6 shadow-[0_12px_32px_rgba(17,17,17,0.05)]">
                <p className="text-sm font-semibold text-black">Checking secure access...</p>
                <p className="mt-2 text-sm leading-7 text-black/62">
                  Restoring the local unlock state for this tab before the chat interface loads.
                </p>
              </div>
            ) : (
              <form
                onSubmit={isSetupFlow ? handleSetupSubmit : handleUnlockSubmit}
                className="mt-8 space-y-5"
              >
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-black/50">
                    {isSetupFlow ? "Enter PIN" : "PIN"}
                  </span>
                  <input
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="one-time-code"
                    value={pin}
                    onChange={(event) => {
                      setPin(sanitizePinValue(event.target.value));
                      setError(null);
                    }}
                    className="mt-2 w-full rounded-2xl border border-stone-300 bg-white px-4 py-4 text-center font-mono text-2xl tracking-[0.42em] text-black outline-none transition focus:border-amber-500 focus:ring-4 focus:ring-amber-100"
                    placeholder="000000"
                    maxLength={PIN_LENGTH}
                    required
                  />
                </label>

                {isSetupFlow ? (
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-black/50">
                      Re-enter PIN
                    </span>
                    <input
                      type="password"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="one-time-code"
                      value={confirmPin}
                      onChange={(event) => {
                        setConfirmPin(sanitizePinValue(event.target.value));
                        setError(null);
                      }}
                      className="mt-2 w-full rounded-2xl border border-stone-300 bg-white px-4 py-4 text-center font-mono text-2xl tracking-[0.42em] text-black outline-none transition focus:border-amber-500 focus:ring-4 focus:ring-amber-100"
                      placeholder="000000"
                      maxLength={PIN_LENGTH}
                      required
                    />
                  </label>
                ) : null}

                <div className="rounded-[24px] border border-stone-200 bg-white/78 px-4 py-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-black/45">
                    Format
                  </p>
                  <p className="mt-2 text-sm leading-7 text-black/66">
                    Numbers only. Use exactly six digits. This PIN protects local re-entry after the
                    tab or desktop app closes.
                  </p>
                </div>

                <div className="flex flex-col gap-3 pt-2 sm:flex-row">
                  <button
                    type="submit"
                    disabled={submitting || (pinConfigured && !isHydrated)}
                    className="inline-flex min-h-12 flex-1 items-center justify-center rounded-2xl border border-amber-400 bg-[linear-gradient(180deg,#fde68a,#fbbf24)] px-5 py-3 text-sm font-semibold text-black shadow-[0_14px_26px_rgba(180,83,9,0.15)] transition hover:brightness-[1.02] disabled:cursor-not-allowed disabled:border-stone-300 disabled:bg-stone-200 disabled:shadow-none"
                  >
                    {submitLabel}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleLogout()}
                    disabled={submitting}
                    className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-stone-300 bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:bg-stone-100"
                  >
                    Sign out
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
