// Purpose: renders a file's visibility (public/private/unlisted) as a small colored badge.
// Usage: shared by FileBoard (list rows) and FileDetailPage (detail header).
// Rationale: chosen over duplicating this into FileDetailPage — a purely mechanical extraction
//   (no logic change) kept FileBoard's render output identical, so the modification risk stayed
//   very low despite touching two files instead of one.

import type { FileVisibility } from '../../api/types'

const VISIBILITY_STYLE: Record<FileVisibility, { label: string; background: string; color: string }> = {
  public: { label: 'Public', background: '#e6f4ea', color: '#1e7e34' },
  private: { label: 'Private', background: '#fdecea', color: '#b3261e' },
  unlisted: { label: 'Unlisted', background: '#fff4e0', color: '#996a13' },
}

export function VisibilityBadge({ visibility }: { visibility: FileVisibility }) {
  const { label, background, color } = VISIBILITY_STYLE[visibility]
  return (
    <span
      style={{
        fontSize: '0.75rem',
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 999,
        background,
        color,
      }}
    >
      {label}
    </span>
  )
}
