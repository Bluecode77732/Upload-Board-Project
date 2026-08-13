// Purpose: FileStorage adapter porting the pre-ADR-0029 local-disk behavior behind the new port, unchanged.
// Usage: constructed by StorageModule's factory when STORAGE_DRIVER=local (the default); never imported directly by consumers.
// Rationale: ADR 0005's disk mechanics (temp_/granted_ folders, Range reads, guarded batched unlink) had to survive the port intact so this ADR is a pure refactor of call sites, not a behavior change.

import { Injectable, Logger } from '@nestjs/common';
import {
  access,
  readdir,
  rename,
  stat as fsStat,
  unlink,
  writeFile,
} from 'fs/promises';
import { createReadStream } from 'fs';
import { join } from 'path';
import { Readable } from 'stream';
import {
  FileStorage,
  StorageByteRange,
  StorageTempEntry,
  StorageUnlinkResult,
} from './file-storage.interface';

const TEMP_DIR = join('file', 'temp');
// Only ever unlink inside the promoted-upload folder for a granted key — mirrors the
// guard `unlink-stored-files.ts` carried before this ADR (a row can hold a path outside
// file/upload if UpdateFileDto ever accepted a bare name with no folder).
const UPLOAD_PREFIX = 'file/upload/';
// Bound parallelism so deleting an account's whole library, or a large temp/ backlog,
// cannot open thousands of concurrent fs handles at once (ADR 0018's batching rationale,
// now shared by every unlink caller through this one adapter method).
const UNLINK_BATCH_SIZE = 100;

@Injectable()
export class LocalDiskStorage implements FileStorage {
  private readonly logger = new Logger(LocalDiskStorage.name);

  // 목적: 첨부 직후 temp 바이트를 file/temp 아래에 쓴다.
  // 이유: UploadService가 Multer memoryStorage로 받은 버퍼를 어딘가에 영속화해야 다음 청구 단계가 가능하다.
  // 방법: fs/promises.writeFile로 버퍼를 그대로 파일에 쓴다.
  async saveTemp(tempKey: string, data: Buffer): Promise<void> {
    await writeFile(join(process.cwd(), TEMP_DIR, tempKey), data);
  }

  // 목적: ADR 0019 청구 전제조건 — temp 객체가 아직 승격되지 않은 채 남아 있는지 확인한다.
  // 이유: 승격 전 재제출(재시도)과 이미 스윕된 만료 파일을 구분해야 400/재생 여부를 판정할 수 있다.
  // 방법: fs.access 성공 여부만 boolean으로 좁힌다 — 실패 사유는 호출자에게 의미가 없다.
  async existsTemp(tempKey: string): Promise<boolean> {
    try {
      await access(join(process.cwd(), TEMP_DIR, tempKey));
      return true;
    } catch {
      return false;
    }
  }

  // 목적: temp 객체를 granted 키로 승격한다(temp_ -> granted_, ADR 0003).
  // 이유: 물리 이동과 DB insert가 한 트랜잭션에 있어야 하는 순서를 FileService가 그대로 유지할 수 있어야 한다.
  // 방법: grantedKey가 이미 'file/upload/...' 형태(FileEntity.filePath와 동일 문자열)이므로 그대로 cwd에 결합해 rename.
  async promote(tempKey: string, grantedKey: string): Promise<void> {
    await rename(
      join(process.cwd(), TEMP_DIR, tempKey),
      join(process.cwd(), grantedKey),
    );
  }

  // 목적: 저장된 객체의 바이트 크기를 돌려준다.
  // 이유: Content-Length 헤더와 Range 파싱(끝 경계 계산)에 크기가 필요하다.
  // 방법: fs/promises.stat의 size 필드만 좁혀서 반환한다.
  async stat(key: string): Promise<{ size: number }> {
    const stats = await fsStat(join(process.cwd(), key));
    return { size: stats.size };
  }

  // 목적: 저장된 객체를 읽는 스트림을 만든다, 필요하면 바이트 범위로 제한한다.
  // 이유: 비디오/오디오 탐색(seek)이 Range 요청에 의존한다(ADR 0025/0026).
  // 방법: fs.createReadStream에 range가 있으면 start/end를 그대로 전달한다 — 비동기 시그니처는 S3 어댑터와의 통일을 위함.
  createReadStream(key: string, range?: StorageByteRange): Promise<Readable> {
    const absolutePath = join(process.cwd(), key);
    return Promise.resolve(
      range
        ? createReadStream(absolutePath, {
            start: range.start,
            end: range.end,
          })
        : createReadStream(absolutePath),
    );
  }

  // 목적: 저장 경로 목록의 물리 파일을 지우고, 남은 것은 실패 목록으로 드러낸다.
  // 이유: unlink 실패가 이미 확정된 DB 삭제를 되돌릴 수는 없으므로, 조용히 새는 대신 관측 가능해야 한다(ADR 0020).
  // 방법: granted(file/upload/ 접두) 또는 temp(temp_ 접두) 키만 대상으로 삼아 배치 단위 allSettled로 지운다.
  async unlink(keys: string[]): Promise<StorageUnlinkResult> {
    const result: StorageUnlinkResult = { deleted: 0, failures: [] };

    const targets: { key: string; absolutePath: string }[] = [];
    for (const key of keys) {
      const absolutePath = this.resolveUnlinkPath(key);
      if (absolutePath) {
        targets.push({ key, absolutePath });
      } else {
        result.failures.push({ key, reason: 'not a recognized storage key' });
      }
    }

    for (let i = 0; i < targets.length; i += UNLINK_BATCH_SIZE) {
      const batch = targets.slice(i, i + UNLINK_BATCH_SIZE);
      const settled = await Promise.allSettled(
        batch.map((target) => unlink(target.absolutePath)),
      );

      settled.forEach((outcome, index) => {
        if (outcome.status === 'fulfilled') {
          result.deleted += 1;
          return;
        }
        const reason: unknown = outcome.reason;
        result.failures.push({
          key: batch[index].key,
          reason: reason instanceof Error ? reason.message : String(reason),
        });
      });
    }

    return result;
  }

  // 목적: file/temp에 있는 모든 temp 객체와 나이를 나열한다(ADR 0018 고아 스윕용).
  // 이유: 스윕이 만료 여부를 판정하려면 각 파일의 마지막 수정 시각이 필요하다.
  // 방법: readdir 후 temp_ 접두만 통과, stat으로 mtimeMs를 읽는다 — 스윕 중 사라진 파일은 건너뛴다.
  async listTemp(): Promise<StorageTempEntry[]> {
    const dir = join(process.cwd(), TEMP_DIR);

    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (error) {
      // An absent file/temp is a normal empty state (nothing uploaded yet) — not an error.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      this.logger.error(
        `Could not read ${TEMP_DIR}.`,
        error instanceof Error ? error.stack : String(error),
      );
      return [];
    }

    const result: StorageTempEntry[] = [];
    for (const name of entries) {
      if (!name.startsWith('temp_')) continue;
      try {
        const info = await fsStat(join(dir, name));
        if (info.isFile()) result.push({ key: name, mtimeMs: info.mtimeMs });
      } catch {
        // A file vanishing mid-list (a concurrent promotion rename) is benign — skip it.
        continue;
      }
    }
    return result;
  }

  private resolveUnlinkPath(key: string): string | null {
    if (key.startsWith(UPLOAD_PREFIX)) return join(process.cwd(), key);
    if (key.startsWith('temp_')) return join(process.cwd(), TEMP_DIR, key);
    return null;
  }
}
