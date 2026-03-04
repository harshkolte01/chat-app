"use client";

import { RefObject, useCallback, useEffect, useRef, useState } from "react";

type EmojiDataRecord = Record<string, unknown>;
type EmojiMartPickerConstructor = new (props: EmojiMartPickerProps) => HTMLElement;

type EmojiPickerSelection = {
  native?: string;
};

type EmojiMartPickerProps = {
  data: EmojiDataRecord;
  onEmojiSelect: (selection: unknown) => void;
  theme: "light";
  previewPosition: "none";
  skinTonePosition: "search";
  searchPosition: "sticky";
  navPosition: "bottom";
  maxFrequentRows: number;
};

type EmojiPickerProps = {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onSelect: (emoji: string) => void;
  onClose: () => void;
};

function resolveEmojiData(moduleData: unknown): EmojiDataRecord | null {
  if (moduleData && typeof moduleData === "object") {
    if (
      "default" in moduleData &&
      moduleData.default &&
      typeof moduleData.default === "object"
    ) {
      return moduleData.default as EmojiDataRecord;
    }

    return moduleData as EmojiDataRecord;
  }

  return null;
}

function extractNativeEmoji(selection: unknown): string | null {
  if (!selection || typeof selection !== "object") {
    return null;
  }

  const candidate = selection as EmojiPickerSelection;
  if (typeof candidate.native !== "string" || candidate.native.length === 0) {
    return null;
  }

  return candidate.native;
}

export function EmojiPicker({ open, anchorRef, onSelect, onClose }: EmojiPickerProps) {
  const desktopPickerRef = useRef<HTMLDivElement | null>(null);
  const mobileSheetRef = useRef<HTMLDivElement | null>(null);
  const desktopPickerHostRef = useRef<HTMLDivElement | null>(null);
  const mobilePickerHostRef = useRef<HTMLDivElement | null>(null);
  const [emojiData, setEmojiData] = useState<EmojiDataRecord | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [pickerConstructor, setPickerConstructor] = useState<EmojiMartPickerConstructor | null>(
    null,
  );

  useEffect(() => {
    if (!open || emojiData || loadError) {
      return;
    }

    let active = true;

    void import("@emoji-mart/data")
      .then((moduleData) => {
        if (!active) {
          return;
        }

        const resolved = resolveEmojiData(moduleData);
        if (!resolved) {
          setLoadError(true);
          return;
        }

        setEmojiData(resolved);
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setLoadError(true);
      });

    return () => {
      active = false;
    };
  }, [emojiData, loadError, open]);

  useEffect(() => {
    if (!open || pickerConstructor || loadError) {
      return;
    }

    let active = true;

    void import("emoji-mart")
      .then((moduleData) => {
        if (!active) {
          return;
        }

        if (typeof moduleData.Picker !== "function") {
          setLoadError(true);
          return;
        }

        setPickerConstructor(
          () => moduleData.Picker as unknown as EmojiMartPickerConstructor,
        );
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setLoadError(true);
      });

    return () => {
      active = false;
    };
  }, [loadError, open, pickerConstructor]);

  const handleEmojiSelect = useCallback(
    (selection: unknown) => {
      const emoji = extractNativeEmoji(selection);
      if (!emoji) {
        return;
      }
      onSelect(emoji);
    },
    [onSelect],
  );

  useEffect(() => {
    if (!open || !emojiData || !pickerConstructor) {
      return;
    }

    const pickerProps: EmojiMartPickerProps = {
      data: emojiData,
      onEmojiSelect: handleEmojiSelect,
      theme: "light",
      previewPosition: "none",
      skinTonePosition: "search",
      searchPosition: "sticky",
      navPosition: "bottom",
      maxFrequentRows: 2,
    };

    const desktopHost = desktopPickerHostRef.current;
    const mobileHost = mobilePickerHostRef.current;
    const desktopPicker = desktopHost ? new pickerConstructor(pickerProps) : null;
    const mobilePicker = mobileHost ? new pickerConstructor(pickerProps) : null;

    if (desktopHost && desktopPicker) {
      desktopHost.replaceChildren(desktopPicker);
    }
    if (mobileHost && mobilePicker) {
      mobileHost.replaceChildren(mobilePicker);
    }

    return () => {
      if (desktopHost) {
        desktopHost.replaceChildren();
      }
      if (mobileHost) {
        mobileHost.replaceChildren();
      }
      desktopPicker?.remove();
      mobilePicker?.remove();
    };
  }, [emojiData, handleEmojiSelect, open, pickerConstructor]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (!(event.target instanceof Node)) {
        return;
      }

      const target = event.target;
      const clickedAnchor = anchorRef.current?.contains(target) ?? false;
      const clickedDesktopPicker = desktopPickerRef.current?.contains(target) ?? false;
      const clickedMobileSheet = mobileSheetRef.current?.contains(target) ?? false;

      if (!clickedAnchor && !clickedDesktopPicker && !clickedMobileSheet) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [anchorRef, onClose, open]);

  if (!open) {
    return null;
  }

  const pickerFallbackElement = loadError ? (
    <div className="flex h-64 w-full items-center justify-center px-4 text-center text-sm text-black/65">
      Unable to load emoji picker. Please try again.
    </div>
  ) : (
    <div className="flex h-64 w-full items-center justify-center px-4 text-sm text-black/65">
      Preparing emojis...
    </div>
  );
  const showPickerHost = Boolean(emojiData && pickerConstructor && !loadError);

  return (
    <>
      <div
        aria-hidden="true"
        className="fixed inset-0 z-40 bg-black/30 sm:hidden"
        onClick={onClose}
      />

      <div ref={desktopPickerRef} className="absolute bottom-full right-0 z-50 mb-2 hidden sm:block">
        <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0_20px_48px_rgba(17,17,17,0.18)]">
          {showPickerHost ? <div ref={desktopPickerHostRef} /> : pickerFallbackElement}
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-50 sm:hidden">
        <div
          ref={mobileSheetRef}
          role="dialog"
          aria-modal="true"
          aria-label="Emoji picker"
          className="rounded-t-2xl border border-stone-200 bg-white shadow-[0_-14px_42px_rgba(17,17,17,0.2)]"
        >
          <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-stone-300" />
          <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2">
            <p className="text-sm font-semibold text-black">Choose emoji</p>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-xs font-semibold text-black transition hover:bg-stone-100"
            >
              Close
            </button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto pb-4">
            {showPickerHost ? <div ref={mobilePickerHostRef} /> : pickerFallbackElement}
          </div>
        </div>
      </div>
    </>
  );
}
