/**
 * The Lyric Presenter icon: a chapel arch and cross framing three lines of lyrics.
 * Colours come from --logo-tile and --logo-mark, so it inverts in dark mode.
 * The simplified version used for the browser tab is in client/public/favicon.svg.
 * Decorative: the app name is always written next to it.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg className={className ? `logo ${className}` : "logo"} viewBox="0 0 256 256" aria-hidden>
      <rect className="logo-tile" width="256" height="256" rx="56" />
      <g className="logo-mark">
        <rect x="124" y="22" width="8" height="34" rx="2" />
        <rect x="113" y="32" width="30" height="8" rx="2" />
        <path d="M78 208V122Q78 92 128 64Q178 92 178 122V208Z" fill="none" strokeWidth="8" strokeLinejoin="round" />
        <rect x="106" y="124" width="44" height="10" rx="5" fillOpacity=".5" />
        <rect x="94" y="150" width="68" height="10" rx="5" />
        <rect x="100" y="176" width="56" height="10" rx="5" fillOpacity=".5" />
      </g>
    </svg>
  );
}
