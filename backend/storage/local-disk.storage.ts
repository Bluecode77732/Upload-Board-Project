// 목적: ADR 0029 이전의 local-disk 동작을 새 포트 뒤로 그대로 옮겨온 FileStorage 어댑터다.
// 사용처: STORAGE_DRIVER=local(기본값)일 때 StorageModule의 팩토리가 생성한다 — 소비자가 직접 임포트하는 일은 없다.
// 이유: ADR 0005의 디스크 메커니즘(temp_/granted_ 폴더, Range 읽기, 가드된 배치 unlink)이 포트 안에서 그대로 살아남아야 했다 — 그래야 이 ADR이 동작 변경이 아니라 호출부의 순수 리팩터링이 된다.

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
const UPLOAD_DIR = join('file', 'upload');
// granted 키는 오직 승격된 upload 폴더 안에서만 unlink한다 — 이 ADR 이전에
// `unlink-stored-files.ts`가 갖고 있던 가드와 같다(UpdateFileDto가 폴더 없는 bare
// 이름을 받아들인 적이 있다면, 행이 file/upload 바깥의 경로를 가질 수도 있었다).
const UPLOAD_PREFIX = 'file/upload/';
// 병렬성을 제한해, 계정 전체 라이브러리를 지우거나 temp/ 적체가 크더라도 수천 개의
// fs 핸들을 동시에 여는 일이 없게 한다(ADR 0018의 배치 근거를 이제 이 어댑터 메서드 하나를
// 거치는 모든 unlink 호출자가 공유한다).
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
      // file/temp가 없는 건 정상적인 빈 상태다(아직 아무것도 업로드되지 않음) — 에러가 아니다.
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
        // 목록 조회 중 파일이 사라지는 건(동시 승격 rename) 무해하다 — 건너뛴다.
        continue;
      }
    }
    return result;
  }

  // 목적: file/upload에 있는 모든 granted 객체와 나이를 나열한다(ADR 0051이 DB와 대조해 훑는 용도).
  // 이유: DB에 없는 키를 골라내려고 훑으려면 실제 목록이 필요하고, 승격 레이스를 걸러내려면 나이도 필요하다.
  // 방법: readdir 후 granted_ 접두만 통과, key는 FileEntity.filePath와 동일한 'file/upload/...' 문자열로 반환한다 — 스윕 중 사라진 파일은 건너뛴다.
  async listGranted(): Promise<StorageTempEntry[]> {
    const dir = join(process.cwd(), UPLOAD_DIR);

    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (error) {
      // file/upload가 없는 건 정상적인 빈 상태다(아직 아무것도 승격되지 않음) — 에러가 아니다.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      this.logger.error(
        `Could not read ${UPLOAD_DIR}.`,
        error instanceof Error ? error.stack : String(error),
      );
      return [];
    }

    const result: StorageTempEntry[] = [];
    for (const name of entries) {
      if (!name.startsWith('granted_')) continue;
      try {
        const info = await fsStat(join(dir, name));
        if (info.isFile()) {
          result.push({
            key: `${UPLOAD_PREFIX}${name}`,
            mtimeMs: info.mtimeMs,
          });
        }
      } catch {
        // 목록 조회 중 파일이 사라지는 건(동시 삭제) 무해하다 — 건너뛴다.
        continue;
      }
    }
    return result;
  }

  // 목적: presigned 읽기 URL을 요청받았을 때 이 어댑터가 지원 불가함을 알린다.
  // 이유: 로컬 디스크에는 서명 URL 개념이 없다 — 컨트롤러가 null을 받아 기존
  //       stat()/createReadStream() 스트리밍 경로로 폴백하도록 하는 신호가 필요하다(ADR 0036).
  // 방법: 항상 null을 반환한다 — 예외를 던지지 않는다(existsTemp의 boolean 계약과 같은 성격).
  getSignedReadUrl(key: string, contentType: string): Promise<string | null> {
    // 의도적으로 미사용 — FileStorage의 인자 개수를 맞추려고 이름만 남겨둔다(ADR 0036).
    void key;
    void contentType;
    return Promise.resolve(null);
  }

  // 목적: unlink 대상 키가 granted/temp 중 어느 쪽인지 판별해 절대 경로로 바꾼다.
  // 이유: unlink()가 임의의 문자열을 그대로 fs.unlink에 넘기면 file/upload·file/temp
  //       바깥의 경로도 지울 수 있다 — 인식 가능한 두 접두사만 허용해야 한다.
  // 방법: file/upload/ 접두는 그대로 cwd에 결합, temp_ 접두는 TEMP_DIR 아래로 결합.
  //       둘 다 아니면 null을 반환해 호출자가 실패로 기록하게 한다.
  private resolveUnlinkPath(key: string): string | null {
    if (key.startsWith(UPLOAD_PREFIX)) return join(process.cwd(), key);
    if (key.startsWith('temp_')) return join(process.cwd(), TEMP_DIR, key);
    return null;
  }
}
