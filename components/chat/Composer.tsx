"use client";

import { ChangeEvent, FormEvent, useCallback, useRef, useState } from "react";
import { EmojiPicker } from "@/components/chat/EmojiPicker";

type ComposerProps = {
  draft: string;
  selectedConversationId: string | null;
  sendingMessage: boolean;
  uploadingImage: boolean;
  cameraStarting: boolean;
  onDraftChange: (value: string) => void;
  onSendMessage: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onImageSelected: (event: ChangeEvent<HTMLInputElement>) => void | Promise<void>;
  onOpenCamera: () => void | Promise<void>;
};

export function Composer({
  draft,
  selectedConversationId,
  sendingMessage,
  uploadingImage,
  cameraStarting,
  onDraftChange,
  onSendMessage,
  onImageSelected,
  onOpenCamera,
}: ComposerProps) {
  const imagePickerInputRef = useRef<HTMLInputElement | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);
  const emojiButtonRef = useRef<HTMLButtonElement | null>(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);

  const isComposerDisabled = !selectedConversationId || sendingMessage || uploadingImage;
  const areActionButtonsDisabled =
    !selectedConversationId || uploadingImage || sendingMessage || cameraStarting;
  const isEmojiPickerVisible = emojiPickerOpen && !isComposerDisabled;

  const handleEmojiSelect = useCallback(
    (emoji: string) => {
      const input = textInputRef.current;
      const baseDraft = draft;

      if (!input) {
        onDraftChange(`${baseDraft}${emoji}`);
        setEmojiPickerOpen(false);
        return;
      }

      const selectionStart = input.selectionStart ?? baseDraft.length;
      const selectionEnd = input.selectionEnd ?? baseDraft.length;
      const nextDraft =
        baseDraft.slice(0, selectionStart) + emoji + baseDraft.slice(selectionEnd);

      onDraftChange(nextDraft);
      setEmojiPickerOpen(false);

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
    [draft, onDraftChange],
  );

  return (
    <form
      onSubmit={(event) => {
        setEmojiPickerOpen(false);
        void onSendMessage(event);
      }}
      className="mt-2 flex flex-col gap-2 border-t border-stone-200 pt-3 sm:flex-row sm:items-center"
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

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setEmojiPickerOpen(false);
            imagePickerInputRef.current?.click();
          }}
          disabled={areActionButtonsDisabled}
          className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-black transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:bg-stone-200"
        >
          {uploadingImage ? "Uploading..." : "Photo"}
        </button>

        <button
          type="button"
          onClick={() => {
            setEmojiPickerOpen(false);
            void onOpenCamera();
          }}
          disabled={areActionButtonsDisabled}
          className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-black transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:bg-stone-200"
        >
          {cameraStarting ? "Opening..." : "Camera"}
        </button>

        <div className="relative">
          <button
            ref={emojiButtonRef}
            type="button"
            onClick={() => setEmojiPickerOpen((previous) => !previous)}
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

      <input
        ref={textInputRef}
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        placeholder={
          selectedConversationId
            ? "Type a private message"
            : "Start or select a conversation first"
        }
        className="w-full flex-1 rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-black outline-none transition focus:border-stone-700 focus:ring-2 focus:ring-stone-300"
        disabled={isComposerDisabled}
      />

      <button
        type="submit"
        disabled={!selectedConversationId || sendingMessage || uploadingImage || !draft.trim()}
        className="rounded-xl border border-stone-300 bg-amber-100 px-4 py-2 text-sm font-semibold text-black transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:bg-stone-200"
      >
        {sendingMessage ? "Sending..." : "Send"}
      </button>
    </form>
  );
}
