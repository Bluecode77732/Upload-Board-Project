// 목적: 고아 granted_ 객체를 순수하게 DB와 대조해 골라낸다 — 삭제 판단을 DB나 스토리지 어댑터 없이 단위 테스트할 수 있도록 분리했다.
// 사용처: GrantedCleanupService.sweep()이 FileStorage 포트로 file/upload 목록을 받고 DB에서 filePath 값을 읽은 뒤 이 함수를 호출한다.
// 이유: "어떤 객체가 고아인가"라는 규칙을 I/O 경로 밖에 둬야 직접 검증할 수 있다 — select-expired-temp-files.ts(ADR 0018)와 같은 방식이다.
// 목적: file_entity.filePath에 없는 granted_ 객체 중 minAgeMs보다 나이가 많은 키만 골라 돌려준다(ADR 0051 D3).
// 이유: storage.promote()가 커밋 전 트랜잭션 안에서 실행되므로, 그 틈에 목록을 뜨면 아직 행이 안 생긴
//       진행 중인 정상 승격을 고아로 오판할 수 있다 — minAgeMs가 그 레이스를 걸러내는 최소 나이 기준이다.
// 방법: file/upload/ 접두사를 여기서 다시 확인해(호출자가 걸러지지 않은 목록을 넘겨도 안전하도록,
//       selectExpiredTempFiles와 같은 방어), DB에 없고 나이 조건도 만족하는 키만 필터링한다.

import { StorageTempEntry } from 'backend/storage/file-storage.interface';

export function selectOrphanedGrantedFiles(
  entries: StorageTempEntry[],
  knownFilePaths: ReadonlySet<string>,
  nowMs: number,
  minAgeMs: number,
): string[] {
  return entries
    .filter(
      (e) =>
        e.key.startsWith('file/upload/') &&
        !knownFilePaths.has(e.key) &&
        nowMs - e.mtimeMs > minAgeMs,
    )
    .map((e) => e.key);
}
