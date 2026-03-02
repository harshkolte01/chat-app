"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type LoginResponse = {
  user: {
    id: string;
    username: string;
    email: string;
    createdAt: string;
  };
};

async function login(email: string, password: string): Promise<LoginResponse> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      password,
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      (payload as { error?: { message?: string } } | null)?.error?.message ??
        "Unable to login.",
    );
  }

  return payload as LoginResponse;
}

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submitting) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await login(email.trim(), password);
      router.push("/chat");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to login.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8 sm:px-6 lg:px-8">
      <section className="w-full max-w-5xl overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0_24px_60px_rgba(17,17,17,0.08)]">
        <div className="grid lg:grid-cols-[1.1fr_1fr]">
          <div className="hidden bg-stone-100 p-10 lg:block">
            <p className="inline-flex rounded-full border border-stone-300 bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-black">
              Realtime Workspace
            </p>
            <h1 className="mt-6 max-w-sm text-4xl font-semibold leading-tight text-black">
              Professional chat, focused on clarity.
            </h1>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-black/70">
              Secure signin with a clean light interface designed for phone, laptop, and desktop.
            </p>
            <div className="mt-8 space-y-3 text-sm text-black/85">
              <p>Instant updates with Socket.IO fallback.</p>
              <p>Conversation-first layout for faster team response.</p>
            </div>
          </div>

          <div className="p-6 sm:p-8 lg:p-10">
            <h2 className="mb-1 text-3xl font-semibold text-black">Login</h2>
            <p className="mb-6 text-sm text-black/70">Sign in with your email and password.</p>

            {error ? (
              <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-black">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm text-black outline-none transition focus:border-stone-700 focus:ring-2 focus:ring-stone-300"
                  required
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-black">Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm text-black outline-none transition focus:border-stone-700 focus:ring-2 focus:ring-stone-300"
                  required
                />
              </label>

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl border border-stone-300 bg-amber-100 px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:bg-stone-200"
              >
                {submitting ? "Signing in..." : "Sign in"}
              </button>
            </form>
          </div>
        </div>
      </section>
    </main>
  );
}
