// Purpose: renders a file's visibility (public/private/unlisted) as a small colored badge.
// Usage: shared by FileBoard (list rows) and FileDetailPage (detail header).
// Rationale: chosen over duplicating this into FileDetailPage — a purely mechanical extraction
//   (no logic change) kept FileBoard's render output identical, so the modification risk stayed
//   very low despite touching two files instead of one.

import type { FileVisibility } from '../../api/types'
import styles from './VisibilityBadge.module.css'

const VISIBILITY_LABEL: Record<FileVisibility, string> = {
  public: 'Public',
  private: 'Private',
  unlisted: 'Unlisted',
}

const VISIBILITY_CLASS: Record<FileVisibility, string> = {
  public: styles.public,
  private: styles.private,
  unlisted: styles.unlisted,
}

export function VisibilityBadge({ visibility }: { visibility: FileVisibility }) {
  return <span className={`${styles.badge} ${VISIBILITY_CLASS[visibility]}`}>{VISIBILITY_LABEL[visibility]}</span>
}
