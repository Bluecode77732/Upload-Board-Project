// 목적: 파일의 visibility(public/private/unlisted)를 작은 컬러 배지로 렌더링한다.
// 사용처: FileBoard(목록 행)와 FileDetailPage(상세 헤더)가 함께 쓴다.
// 근거: FileDetailPage에 중복 구현하는 대신 이 방식을 택했다 — 순수 기계적 추출(로직 변경 없음)이라
//   FileBoard의 렌더 결과가 그대로 유지됐고, 두 파일을 건드리는데도 수정 위험은 매우 낮게 유지됐다.

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
