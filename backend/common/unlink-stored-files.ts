// Purpose: best-effort removal of promoted upload files once their DB rows are already gone.
// Usage: called AFTER the owning transaction commits by FileService.deleteFile and UserService.remove.
// Rationale: unlink cannot be rolled back, so it must live outside the DB boundary — and two services now need the same guarded sweep.

import { unlink } from 'fs/promises';
import { join } from 'path';

// Only ever unlink inside the promoted-upload folder. filePath is server-constructed,
// but UpdateFileDto accepts a bare `granted_` name with no folder, so a row can hold a
// path outside file/upload — refuse those rather than unlinking anything else on disk.
const UPLOAD_PREFIX = 'file/upload/';

// Bound parallelism so deleting an account with a large library cannot open thousands
// of concurrent fs handles at once (the TempCleanupService batching rationale).
const UNLINK_BATCH_SIZE = 100;

export interface UnlinkStoredFilesResult {
  deleted: number;
  // One entry per path that stayed on disk; callers log these at warn (ADR 0017).
  failures: { filePath: string; reason: string }[];
}

// 목적: 저장 경로 목록에 해당하는 물리 파일을 지우고, 실패분을 호출자가 로깅할 수 있게 돌려준다.
// 이유: DB 행만 지우면 granted_ 파일이 영구 고아로 남고, 반대로 unlink 실패가 삭제 자체를 되돌려서도 안 된다.
// 방법: file/upload/ 하위 경로만 대상으로 삼고, 배치 단위 allSettled로 하나가 실패해도 나머지를 계속 지운다.
export async function unlinkStoredFiles(
  filePaths: string[],
): Promise<UnlinkStoredFilesResult> {
  const result: UnlinkStoredFilesResult = { deleted: 0, failures: [] };

  const targets = filePaths.filter((filePath) => {
    if (filePath.startsWith(UPLOAD_PREFIX)) return true;
    result.failures.push({
      filePath,
      reason: `not under ${UPLOAD_PREFIX}`,
    });
    return false;
  });

  for (let i = 0; i < targets.length; i += UNLINK_BATCH_SIZE) {
    const batch = targets.slice(i, i + UNLINK_BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map((filePath) => unlink(join(process.cwd(), filePath))),
    );

    settled.forEach((outcome, index) => {
      if (outcome.status === 'fulfilled') {
        result.deleted += 1;
        return;
      }
      const reason: unknown = outcome.reason;
      result.failures.push({
        filePath: batch[index],
        reason: reason instanceof Error ? reason.message : String(reason),
      });
    });
  }

  return result;
}
