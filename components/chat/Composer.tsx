"use client";

import { ChangeEvent, FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { EmojiPicker } from "@/components/chat/EmojiPicker";

type EmojiDataRecord = Record<string, unknown>;
type EmojiSearchIndex = {
  search: (value: string, options?: { maxResults?: number; caller?: string }) => Promise<unknown[]>;
};

type ShortcodeToken = {
  start: number;
  end: number;
  query: string;
};

type EmojiSuggestion = {
  id: string;
  native: string;
  name: string;
  shortcode: string;
};

type ComposerReplyTarget = {
  id: string;
  senderId: string;
  senderUsername: string;
  type: "TEXT" | "IMAGE";
  text: string | null;
  imageKey: string | null;
  createdAt: string;
};

type ComposerProps = {
  draft: string;
  selectedConversationId: string | null;
  sendingMessage: boolean;
  uploadingImage: boolean;
  cameraStarting: boolean;
  currentUserId: string;
  replyingTo: ComposerReplyTarget | null;
  onDraftChange: (value: string) => void;
  onCancelReply: () => void;
  onSendMessage: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onImageSelected: (event: ChangeEvent<HTMLInputElement>) => void | Promise<void>;
  onOpenCamera: () => void | Promise<void>;
};

const SHORTCODE_QUERY_PATTERN = /(^|[\s([{]):([a-z0-9_+-]{2,32})$/i;
const MAX_SHORTCODE_RESULTS = 7;

function formatReplyPreview(replyingTo: ComposerReplyTarget): string {
  if (replyingTo.type === "TEXT") {
    const preview = replyingTo.text?.trim();
    return preview && preview.length > 0 ? preview : "[message]";
  }

  return "[image]";
}

function resolveEmojiData(moduleData: unknown): EmojiDataRecord | null {
  if (!moduleData || typeof moduleData !== "object") {
    return null;
  }

  if (
    "default" in moduleData &&
    moduleData.default &&
    typeof moduleData.default === "object"
  ) {
    return moduleData.default as EmojiDataRecord;
  }

  return moduleData as EmojiDataRecord;
}

function parseShortcodeToken(value: string, caretPosition: number): ShortcodeToken | null {
  if (caretPosition < 0 || caretPosition > value.length) {
    return null;
  }

  const beforeCaret = value.slice(0, caretPosition);
  const match = beforeCaret.match(SHORTCODE_QUERY_PATTERN);
  if (!match) {
    return null;
  }

  const query = match[2];
  const start = beforeCaret.length - query.length - 1;
  return {
    start,
    end: caretPosition,
    query,
  };
}

function normalizeShortcode(shortcodeValue: unknown, fallback: string): string {
  if (typeof shortcodeValue === "string") {
    const normalized = shortcodeValue.replace(/^:+|:+$/g, "").trim();
    if (normalized) {
      return normalized;
    }
  }

  if (Array.isArray(shortcodeValue)) {
    const firstCode = shortcodeValue.find((entry) => typeof entry === "string");
    if (typeof firstCode === "string") {
      const normalized = firstCode.replace(/^:+|:+$/g, "").trim();
      if (normalized) {
        return normalized;
      }
    }
  }

  return fallback;
}

function toEmojiSuggestions(results: unknown[]): EmojiSuggestion[] {
  const mapped: EmojiSuggestion[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    if (!result || typeof result !== "object") {
      continue;
    }

    const candidate = result as {
      id?: unknown;
      name?: unknown;
      shortcodes?: unknown;
      skins?: unknown;
    };
    const id = typeof candidate.id === "string" && candidate.id.length > 0 ? candidate.id : null;
    const name = typeof candidate.name === "string" && candidate.name.length > 0 ? candidate.name : id;
    if (!id || !name) {
      continue;
    }

    if (!Array.isArray(candidate.skins) || candidate.skins.length === 0) {
      continue;
    }

    const firstSkin = candidate.skins[0];
    if (!firstSkin || typeof firstSkin !== "object") {
      continue;
    }

    const native = (firstSkin as { native?: unknown }).native;
    if (typeof native !== "string" || native.length === 0) {
      continue;
    }

    if (seen.has(id)) {
      continue;
    }
    seen.add(id);

    mapped.push({
      id,
      native,
      name,
      shortcode: normalizeShortcode(candidate.shortcodes, id),
    });
  }

  return mapped;
}

export function Composer({
  draft,
  selectedConversationId,
  sendingMessage,
  uploadingImage,
  cameraStarting,
  currentUserId,
  replyingTo,
  onDraftChange,
  onCancelReply,
  onSendMessage,
  onImageSelected,
  onOpenCamera,
}: ComposerProps) {
  const imagePickerInputRef = useRef<HTMLInputElement | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);
  const emojiButtonRef = useRef<HTMLButtonElement | null>(null);
  const attachmentButtonRef = useRef<HTMLButtonElement | null>(null);
  const attachmentDropdownRef = useRef<HTMLDivElement | null>(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [attachmentDropdownOpen, setAttachmentDropdownOpen] = useState(false);
  const [shortcodeToken, setShortcodeToken] = useState<ShortcodeToken | null>(null);
  const [shortcodeSuggestions, setShortcodeSuggestions] = useState<EmojiSuggestion[]>([]);
  const [highlightedSuggestionIndex, setHighlightedSuggestionIndex] = useState(0);
  const searchIndexRef = useRef<EmojiSearchIndex | null>(null);
  const searchInitPromiseRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (!sendingMessage) {
      textInputRef.current?.focus();
    }
  }, [sendingMessage]);

  useEffect(() => {
    if (!attachmentDropdownOpen) return;
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        !attachmentButtonRef.current?.contains(target) &&
        !attachmentDropdownRef.current?.contains(target)
      ) {
        setAttachmentDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [attachmentDropdownOpen]);

  const isComposerDisabled = !selectedConversationId || sendingMessage || uploadingImage;
  const areActionButtonsDisabled =
    !selectedConversationId || uploadingImage || sendingMessage || cameraStarting;
  const isEmojiPickerVisible = emojiPickerOpen && !isComposerDisabled;
  const replySenderLabel = replyingTo
    ? replyingTo.senderId === currentUserId
      ? "You"
      : replyingTo.senderUsername
    : "";
  const replyPreview = replyingTo ? formatReplyPreview(replyingTo) : "";
  const showShortcodeSuggestions =
    !isComposerDisabled &&
    !isEmojiPickerVisible &&
    shortcodeToken !== null &&
    shortcodeSuggestions.length > 0;

  const clearShortcodeSuggestions = useCallback(() => {
    setShortcodeToken(null);
    setShortcodeSuggestions([]);
    setHighlightedSuggestionIndex(0);
  }, []);

  const updateShortcodeToken = useCallback(
    (value: string, caretPosition: number | null) => {
      if (isComposerDisabled || caretPosition === null) {
        clearShortcodeSuggestions();
        return;
      }

      const parsedToken = parseShortcodeToken(value, caretPosition);
      if (!parsedToken) {
        clearShortcodeSuggestions();
        return;
      }

      setShortcodeToken(parsedToken);
    },
    [clearShortcodeSuggestions, isComposerDisabled],
  );

  const ensureEmojiSearchReady = useCallback(async () => {
    if (searchIndexRef.current) {
      return;
    }

    if (searchInitPromiseRef.current) {
      return searchInitPromiseRef.current;
    }

    searchInitPromiseRef.current = (async () => {
      const [dataModule, emojiMartModule] = await Promise.all([
        import("@emoji-mart/data"),
        import("emoji-mart"),
      ]);
      const data = resolveEmojiData(dataModule);
      const init = (emojiMartModule as { init?: unknown }).init;
      const searchIndex = (emojiMartModule as { SearchIndex?: unknown }).SearchIndex;

      if (!data || typeof init !== "function") {
        throw new Error("Emoji search initialization failed.");
      }

      if (
        !searchIndex ||
        typeof searchIndex !== "object" ||
        typeof (searchIndex as EmojiSearchIndex).search !== "function"
      ) {
        throw new Error("Emoji search is unavailable.");
      }

      await Promise.resolve((init as (options: { data: EmojiDataRecord }) => void | Promise<void>)({ data }));
      searchIndexRef.current = searchIndex as EmojiSearchIndex;
    })();

    try {
      await searchInitPromiseRef.current;
    } finally {
      if (!searchIndexRef.current) {
        searchInitPromiseRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    if (!shortcodeToken || isComposerDisabled || isEmojiPickerVisible) {
      setShortcodeSuggestions([]);
      setHighlightedSuggestionIndex(0);
      return;
    }

    let canceled = false;

    void ensureEmojiSearchReady()
      .then(async () => {
        if (canceled || !searchIndexRef.current) {
          return;
        }

        const searchResults = await searchIndexRef.current.search(shortcodeToken.query, {
          maxResults: MAX_SHORTCODE_RESULTS,
          caller: "chat-composer-shortcode",
        });
        if (canceled) {
          return;
        }

        const nextSuggestions = toEmojiSuggestions(searchResults).slice(0, MAX_SHORTCODE_RESULTS);
        setShortcodeSuggestions(nextSuggestions);
        setHighlightedSuggestionIndex((previous) =>
          nextSuggestions.length === 0 ? 0 : Math.min(previous, nextSuggestions.length - 1),
        );
      })
      .catch(() => {
        if (canceled) {
          return;
        }
        setShortcodeSuggestions([]);
        setHighlightedSuggestionIndex(0);
      });

    return () => {
      canceled = true;
    };
  }, [ensureEmojiSearchReady, isComposerDisabled, isEmojiPickerVisible, shortcodeToken]);

  const handleEmojiSelect = useCallback(
    (emoji: string) => {
      const input = textInputRef.current;
      const baseDraft = draft;

      if (!input) {
        onDraftChange(`${baseDraft}${emoji}`);
        return;
      }

      const selectionStart = input.selectionStart ?? baseDraft.length;
      const selectionEnd = input.selectionEnd ?? baseDraft.length;
      const nextDraft =
        baseDraft.slice(0, selectionStart) + emoji + baseDraft.slice(selectionEnd);

      onDraftChange(nextDraft);
      clearShortcodeSuggestions();

      requestAnimationFrame(() => {
        const currentInput = textInputRef.current;
        if (!currentInput || currentInput.disabled) {
          return;
        }

        const nextCaretPosition = selectionStart + emoji.length;
        currentInput.focus();
        currentInput.setSelectionRange(nextCaretPosition, nextCaretPosition);
      });
    },
    [clearShortcodeSuggestions, draft, onDraftChange],
  );

  const applyShortcodeSuggestion = useCallback(
    (suggestion: EmojiSuggestion) => {
      if (!shortcodeToken) {
        return;
      }

      const prefix = draft.slice(0, shortcodeToken.start);
      const suffix = draft.slice(shortcodeToken.end);
      const shouldAddTrailingSpace = suffix.length === 0 || !/^\s/.test(suffix);
      const insertion = `${suggestion.native}${shouldAddTrailingSpace ? " " : ""}`;
      const nextDraft = `${prefix}${insertion}${suffix}`;
      const nextCaretPosition = prefix.length + insertion.length;

      onDraftChange(nextDraft);
      clearShortcodeSuggestions();

      requestAnimationFrame(() => {
        const currentInput = textInputRef.current;
        if (!currentInput || currentInput.disabled) {
          return;
        }

        currentInput.focus();
        currentInput.setSelectionRange(nextCaretPosition, nextCaretPosition);
      });
    },
    [clearShortcodeSuggestions, draft, onDraftChange, shortcodeToken],
  );

  const onInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (!showShortcodeSuggestions) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlightedSuggestionIndex((previous) => (previous + 1) % shortcodeSuggestions.length);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlightedSuggestionIndex(
          (previous) => (previous - 1 + shortcodeSuggestions.length) % shortcodeSuggestions.length,
        );
        return;
      }

      if (event.key === "Enter" || event.key === "Tab") {
        const suggestion = shortcodeSuggestions[highlightedSuggestionIndex];
        if (!suggestion) {
          return;
        }

        event.preventDefault();
        applyShortcodeSuggestion(suggestion);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        clearShortcodeSuggestions();
      }
    },
    [
      applyShortcodeSuggestion,
      clearShortcodeSuggestions,
      highlightedSuggestionIndex,
      shortcodeSuggestions,
      showShortcodeSuggestions,
    ],
  );

  return (
    <form
      onSubmit={(event) => {
        setEmojiPickerOpen(false);
        setAttachmentDropdownOpen(false);
        clearShortcodeSuggestions();
        void onSendMessage(event);
      }}
      className="mt-2 border-t border-stone-200 pt-3"
    >
      <input
        ref={imagePickerInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          void onImageSelected(event);
        }}
      />

      {replyingTo ? (
        <div className="mb-2 rounded-xl border border-stone-300 bg-stone-50 px-3 py-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-black/70">
                Replying to {replySenderLabel}
              </p>
              <p className="truncate text-sm text-black">{replyPreview}</p>
            </div>
            <button
              type="button"
              onClick={onCancelReply}
              className="shrink-0 rounded-md border border-stone-300 bg-white px-2 py-1 text-[11px] font-semibold text-black transition hover:bg-stone-100"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              ref={attachmentButtonRef}
              type="button"
              onClick={() => {
                setEmojiPickerOpen(false);
                clearShortcodeSuggestions();
                setAttachmentDropdownOpen((prev) => !prev);
              }}
              disabled={areActionButtonsDisabled}
              aria-label="Attach photo or camera"
              aria-haspopup="menu"
              aria-expanded={attachmentDropdownOpen}
              className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-black transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:bg-stone-200"
            >
              {uploadingImage ? (
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              ) : cameraStarting ? (
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              ) : (
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.41 17.41a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              )}
            </button>

            {attachmentDropdownOpen && (
              <div
                ref={attachmentDropdownRef}
                role="menu"
                className="absolute bottom-[calc(100%+0.5rem)] left-0 z-90 min-w-40 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-[0_8px_24px_rgba(17,17,17,0.12)]"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAttachmentDropdownOpen(false);
                    imagePickerInputRef.current?.click();
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-sm font-medium text-black transition hover:bg-stone-100"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  Upload Photo
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAttachmentDropdownOpen(false);
                    void onOpenCamera();
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-sm font-medium text-black transition hover:bg-stone-100"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                  Open Camera
                </button>
              </div>
            )}
          </div>

          <div className="relative">
            <button
              ref={emojiButtonRef}
              type="button"
              onClick={() => {
                clearShortcodeSuggestions();
                setEmojiPickerOpen((previous) => !previous);
              }}
              disabled={isComposerDisabled}
              aria-label="Open emoji picker"
              aria-haspopup="dialog"
              aria-expanded={isEmojiPickerVisible}
              className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-black transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:bg-stone-200"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M9 10h.01" />
                <path d="M15 10h.01" />
                <path d="M8 14c1 1.5 2.3 2 4 2s3-.5 4-2" />
              </svg>
            </button>

            <EmojiPicker
              open={isEmojiPickerVisible}
              anchorRef={emojiButtonRef}
              onSelect={handleEmojiSelect}
              onClose={() => setEmojiPickerOpen(false)}
            />
          </div>
        </div>

        <div className="relative w-full flex-1">
          {showShortcodeSuggestions ? (
            <div className="absolute bottom-[calc(100%+0.375rem)] left-0 right-0 z-80 overflow-hidden rounded-xl border border-stone-300 bg-white shadow-[0_14px_30px_rgba(17,17,17,0.12)]">
              {shortcodeSuggestions.map((suggestion, index) => (
                <button
                  key={`${suggestion.id}-${suggestion.shortcode}`}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applyShortcodeSuggestion(suggestion)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-black transition ${
                    index === highlightedSuggestionIndex ? "bg-amber-100" : "hover:bg-stone-100"
                  }`}
                >
                  <span className="text-xl leading-none">{suggestion.native}</span>
                  <span className="truncate text-sm">{suggestion.name}</span>
                  <span className="ml-auto text-xs font-medium text-black/65">
                    :{suggestion.shortcode}:
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          <input
            ref={textInputRef}
            value={draft}
            onChange={(event) => {
              const nextDraft = event.target.value;
              onDraftChange(nextDraft);
              updateShortcodeToken(nextDraft, event.target.selectionStart ?? nextDraft.length);
            }}
            onClick={(event) =>
              updateShortcodeToken(event.currentTarget.value, event.currentTarget.selectionStart)
            }
            onKeyUp={(event) =>
              updateShortcodeToken(event.currentTarget.value, event.currentTarget.selectionStart)
            }
            onKeyDown={onInputKeyDown}
            placeholder={
              selectedConversationId
                ? "Type a private message (use :sm for emoji)"
                : "Start or select a conversation first"
            }
            className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-black outline-none transition focus:border-stone-700 focus:ring-2 focus:ring-stone-300"
            disabled={isComposerDisabled}
          />
        </div>

        <button
          type="submit"
          disabled={!selectedConversationId || sendingMessage || uploadingImage || !draft.trim()}
          className="rounded-xl border border-stone-300 bg-amber-100 px-4 py-2 text-sm font-semibold text-black transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:bg-stone-200"
        >
          {sendingMessage ? "Sending..." : "Send"}
        </button>
      </div>
    </form>
  );
}
