import { cn } from "@/lib/utils";

const PALETTE = [
  "#7c5cff", // violet
  "#ff6b4a", // coral
  "#22b07d", // green
  "#e0479e", // pink
  "#f5a524", // amber
  "#2f8cff", // blue
  "#8b6b4a", // walnut
];

/** Same id, same color, everywhere. */
export function botColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length] ?? "#7c5cff";
}

const BLOBS = [
  "M32 4c13 0 26 9 27 24 1 16-9 31-27 32C14 61 4 48 5 31 6 15 19 4 32 4Z",
  "M30 5c15-2 29 8 29 25 0 17-12 30-28 30C15 60 4 49 5 32 6 17 16 7 30 5Z",
  "M34 5c14 2 25 13 24 28-1 16-13 27-28 26C15 58 5 46 6 31 7 15 20 3 34 5Z",
];

/** A friendly blob with two eyes; each bot gets its own color and silhouette. */
export function BotAvatar({
  seed,
  className,
  size = 40,
}: {
  seed: string;
  className?: string;
  size?: number;
}) {
  const color = botColor(seed);
  const shape = BLOBS[seed.length % BLOBS.length];
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <path d={shape} fill={color} />
      <ellipse cx="38" cy="26" rx="3.2" ry="5.2" fill="#fff" />
      <ellipse cx="48" cy="25" rx="3.2" ry="5.2" fill="#fff" />
      <ellipse cx="39" cy="27.5" rx="1.6" ry="2.6" fill="#111" />
      <ellipse cx="49" cy="26.5" rx="1.6" ry="2.6" fill="#111" />
    </svg>
  );
}
