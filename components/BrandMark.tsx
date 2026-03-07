import Image from "next/image";

type BrandMarkProps = {
  size?: "sm" | "md" | "lg";
  subtitle?: string;
  priority?: boolean;
  className?: string;
};

const IMAGE_SIZE = {
  sm: 44,
  md: 56,
  lg: 72,
} as const;

const TITLE_CLASS = {
  sm: "text-lg",
  md: "text-xl",
  lg: "text-2xl",
} as const;

const SUBTITLE_CLASS = {
  sm: "text-[11px]",
  md: "text-xs",
  lg: "text-sm",
} as const;

export function BrandMark({
  size = "md",
  subtitle,
  priority = false,
  className = "",
}: BrandMarkProps) {
  const imageSize = IMAGE_SIZE[size];

  return (
    <div className={`flex items-center gap-3 ${className}`.trim()}>
      <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white/90 p-1 shadow-[0_12px_24px_rgba(17,17,17,0.08)]">
        <Image
          src="/secretchat.png"
          alt="SecretChat logo"
          width={imageSize}
          height={imageSize}
          sizes={`${imageSize}px`}
          priority={priority}
          className="rounded-xl object-cover"
        />
      </div>

      <div className="min-w-0">
        <p className={`font-semibold tracking-tight text-black ${TITLE_CLASS[size]}`}>SecretChat</p>
        {subtitle ? (
          <p className={`text-black/65 ${SUBTITLE_CLASS[size]}`}>{subtitle}</p>
        ) : null}
      </div>
    </div>
  );
}
