// 목적: 고아 temp_ 객체를 순수하게 TTL로만 골라낸다 — 삭제 판단을 스토리지 어댑터 없이 단위 테스트할 수 있도록 분리했다.
// 사용처: TempCleanupService.sweep()이 FileStorage 포트로 file/temp 항목을 나열한 뒤 이 함수를 호출한다.
// 근거: "어떤 객체가 만료됐는가"라는 규칙을 I/O 경로 밖에 둬야 직접 검증할 수 있다.

import { StorageTempEntry } from 'backend/storage/file-storage.interface';

/**
 * Returns the keys of `temp_`-prefixed objects whose age exceeds the TTL.
 *
 * Defensive by design: it re-checks the `temp_` prefix here, so a non-`temp_`
 * entry (a `granted_` object, a stray artifact) can never be selected for deletion
 * even if the caller passes an unfiltered list — the prefix guard is the last line
 * between this sweep and an irreversible unlink of a claimed file.
 */
export function selectExpiredTempFiles(
  entries: StorageTempEntry[],
  nowMs: number,
  ttlMs: number,
): string[] {
  return entries
    .filter((e) => e.key.startsWith('temp_') && nowMs - e.mtimeMs > ttlMs)
    .map((e) => e.key);
}
