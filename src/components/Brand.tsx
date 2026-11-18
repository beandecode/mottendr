/* Final logo "M5+" (docs/brand/README.md, chosen 2026-11-06): two cards leaning toward each other so
   their outline traces an M, the front one carrying a serif T. The app is spelled Mottendr (mot +
   tendr); the wordmark shows MoTendr, the silent t of "mot" kept as a faded T trailing the real
   one. public/icon.svg and the PNG icons draw the same cards on the dark green tile. */
export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="56 56 400 400"
      aria-hidden="true"
    >
      <rect
        className="brand-mark-back"
        x="-112.6"
        y="-148.5"
        width="225.2"
        height="297"
        rx="35.8"
        transform="translate(180 256) rotate(15) scale(0.96)"
      />
      <g transform="translate(334 256) rotate(-15) scale(0.96)">
        <rect
          className="brand-mark-card"
          x="-112.6"
          y="-148.5"
          width="225.2"
          height="297"
          rx="35.8"
        />
        <path
          className="brand-mark-t"
          transform="translate(0 2) scale(1.18)"
          d="M-58-64H58V-28H53Q51-44 36-45H19Q13-45 13-39V50Q13 61 36 62V68H-36V62Q-13 61-13 50V-39Q-13-45-19-45H-36Q-51-44-53-28H-58Z"
        />
      </g>
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="wordmark">
      Mo
      <span className="wordmark-t">
        <span className="wordmark-ghost" aria-hidden="true">
          T
        </span>
        T
      </span>
      endr
    </span>
  );
}
