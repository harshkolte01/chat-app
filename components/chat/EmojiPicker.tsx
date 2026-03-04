"use client";

import { CSSProperties, RefObject, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type EmojiDataRecord = Record<string, unknown>;
type EmojiMartPickerConstructor = new (props: EmojiMartPickerProps) => HTMLElement;
type DesktopPopoverPosition = {
  left: number;
  top: number;
  width: number;
  placeBelow: boolean;
};

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
  dynamicWidth: boolean;
};

type EmojiPickerProps = {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onSelect: (emoji: string) => void;
  onClose: () => void;
};

const DESKTOP_PICKER_WIDTH = 352;
const DESKTOP_PICKER_HEIGHT = 435;
const VIEWPORT_MARGIN = 8;
const PICKER_OFFSET = 8;

function getDesktopPopoverPosition(anchor: HTMLElement): DesktopPopoverPosition {
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(DESKTOP_PICKER_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);

  let left = rect.right - width;
  left = Math.max(VIEWPORT_MARGIN, Math.min(left, window.innerWidth - VIEWPORT_MARGIN - width));

  const spaceAbove = rect.top - VIEWPORT_MARGIN;
  const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
  const placeBelow = spaceAbove < DESKTOP_PICKER_HEIGHT && spaceBelow > spaceAbove;
  const top = placeBelow ? rect.bottom + PICKER_OFFSET : rect.top - PICKER_OFFSET;

  return {
    left,
    top,
    width,
    placeBelow,
  };
}

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
  const [desktopPosition, setDesktopPosition] = useState<DesktopPopoverPosition | null>(null);

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

  const updateDesktopPosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor || typeof window === "undefined") {
      setDesktopPosition(null);
      return;
    }

    setDesktopPosition(getDesktopPopoverPosition(anchor));
  }, [anchorRef]);

  useEffect(() => {
    if (!open) {
      return;
    }

    updateDesktopPosition();

    const handleViewportChange = () => {
      updateDesktopPosition();
    };

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open, updateDesktopPosition]);

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
      dynamicWidth: true,
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
  }, [desktopPosition, emojiData, handleEmojiSelect, open, pickerConstructor]);

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
  const desktopPopoverStyle: CSSProperties | undefined = desktopPosition
    ? {
        left: desktopPosition.left,
        top: desktopPosition.top,
        width: desktopPosition.width,
        transform: desktopPosition.placeBelow ? "none" : "translateY(-100%)",
      }
    : undefined;
  const desktopPickerNode = (
    <div
      ref={desktopPickerRef}
      className="fixed z-[70] hidden sm:block"
      style={desktopPopoverStyle}
    >
      <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0_20px_48px_rgba(17,17,17,0.18)]">
        {showPickerHost ? <div ref={desktopPickerHostRef} className="w-full" /> : pickerFallbackElement}
      </div>
    </div>
  );

  return (
    <>
      <div
        aria-hidden="true"
        className="fixed inset-0 z-40 bg-black/30 sm:hidden"
        onClick={onClose}
      />

      {typeof document !== "undefined" && desktopPosition
        ? createPortal(desktopPickerNode, document.body)
        : null}

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
            {showPickerHost ? <div ref={mobilePickerHostRef} className="w-full" /> : pickerFallbackElement}
          </div>
        </div>
      </div>
    </>
  );
}
