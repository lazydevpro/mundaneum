/**
 * Inline SVG icons — one stroke, one grid, optically centered. Unicode
 * glyphs render at whatever size and baseline the fallback font fancies;
 * these don't.
 */

export type IconName =
  | 'move'
  | 'pen'
  | 'line'
  | 'box'
  | 'oval'
  | 'arrow'
  | 'undo'
  | 'check'
  | 'x'
  | 'play'
  | 'plus'
  | 'half'
  | 'up'
  | 'note'
  | 'sparkle'
  | 'grid'
  | 'lines'
  | 'file'
  | 'boxcheck'
  | 'boxempty'
  | 'erase'

const STROKED: Record<string, React.ReactNode> = {
  move: (
    <>
      <path d="M8 2v12M2 8h12" />
      <path d="M6 3.8 8 1.8l2 2M6 12.2l2 2 2-2M3.8 6l-2 2 2 2M12.2 6l2 2-2 2" />
    </>
  ),
  pen: <path d="M3 13.2 3.8 10 11.2 2.6a1.4 1.4 0 0 1 2 0l.2.2a1.4 1.4 0 0 1 0 2L6 12.2 3 13.2Z" />,
  line: <path d="M3 13 13 3" />,
  box: <rect x="2.8" y="3.6" width="10.4" height="8.8" rx="1.5" />,
  oval: <ellipse cx="8" cy="8" rx="5.6" ry="4.2" />,
  arrow: <path d="M3 13 12.6 3.4M7.8 3h5.2v5.2" />,
  undo: <path d="M5.6 4.4 3 7l2.6 2.6M3.4 7h6.1a3.25 3.25 0 0 1 0 6.5H7" />,
  check: <path d="M3 8.4l3.4 3.4L13 4.4" />,
  x: <path d="M4 4l8 8M12 4l-8 8" />,
  plus: <path d="M8 2.5v11M2.5 8h11" />,
  up: <path d="M8 13V3.4M4 7.2 8 3.2l4 4" />,
  grid: (
    <>
      <rect x="2.8" y="2.8" width="10.4" height="10.4" rx="1.2" />
      <path d="M8 2.8v10.4M2.8 8h10.4" />
    </>
  ),
  lines: <path d="M3 5h10M3 8h10M3 11h10" />,
  file: <path d="M4.2 1.8h4.6L12.8 6v8.2H4.2ZM8.8 1.8V6h4" />,
  boxempty: <rect x="2.8" y="2.8" width="10.4" height="10.4" rx="2" />,
  erase: (
    <>
      <path d="M5.6 13 2.4 9.8a1.4 1.4 0 0 1 0-2L7.6 2.6a1.4 1.4 0 0 1 2 0l3.8 3.8a1.4 1.4 0 0 1 0 2L8.8 13Z" />
      <path d="M5.6 13h7.6M5 6.4l4.6 4.6" />
    </>
  ),
  boxcheck: (
    <>
      <rect x="2.8" y="2.8" width="10.4" height="10.4" rx="2" />
      <path d="M5.2 8.2l2 2 3.6-4" />
    </>
  ),
}

const FILLED: Record<string, React.ReactNode> = {
  play: <path d="M5.4 3.4 12.4 8l-7 4.6Z" />,
  half: (
    <>
      <circle cx="8" cy="8" r="5.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 2.2a5.8 5.8 0 0 1 0 11.6Z" stroke="none" />
    </>
  ),
  note: (
    <>
      <path d="M6.2 12V3.6l6-1.2v8" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="4.4" cy="12" r="1.8" stroke="none" />
      <circle cx="10.4" cy="10.4" r="1.8" stroke="none" />
    </>
  ),
  sparkle: <path d="M8 1.2 9.7 6.3 14.8 8 9.7 9.7 8 14.8 6.3 9.7 1.2 8l5.1-1.7Z" />,
}

export function Icon({ name, size = 15 }: { name: IconName; size?: number }) {
  const filled = name in FILLED
  return (
    <svg
      className="ico"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={filled ? undefined : 1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {filled ? FILLED[name] : STROKED[name]}
    </svg>
  )
}
