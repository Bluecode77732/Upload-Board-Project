// 목적: FileStorage 포트를 정의한다 — 앱이 수행하는 모든 물리 파일 작업을, 뒤에 있는 local-disk/S3 메커니즘과 분리해 담아낸다.
// 사용처: 소비자들(UploadService, FileService, FileContentController, TempCleanupService, UserService)이 FILE_STORAGE를 주입받아 이 메서드들을 호출한다 — fs/promises를 직접 쓰지 않는다.
// 이유: ADR 0005의 "배포 대상 없음" 전제는 이제 사라졌다(ROADMAP §4); 스왑 가능한 어댑터는 S3 기반 다중 인스턴스 배포의 전제조건이다(ADR 0029).

import { Readable } from 'stream';

// TS interface는 런타임 표현이 없다 — Nest가 주입할 때 쓸 토큰이 필요하다.
export const FILE_STORAGE = Symbol('FILE_STORAGE');

export interface StorageByteRange {
  start: number;
  end: number;
}

export interface StorageUnlinkResult {
  deleted: number;
  // 스토리지에 그대로 남은 키마다 항목 하나씩; 호출자는 이걸 warn으로 로그한다(ADR 0017).
  failures: { key: string; reason: string }[];
}

/**
 * An object's key and age, shared by `listTemp()` (the orphan sweep's age signal,
 * ADR 0018) and `listGranted()` (the reclaim sweep's race-guard signal, ADR 0051) — one
 * shape for both since a temp and a granted listing carry the exact same two fields.
 */
export interface StorageTempEntry {
  key: string;
  mtimeMs: number;
}

/**
 * The physical-file port (ADR 0029). Keys are the exact strings this app already
 * uses as identifiers — a temp filename (`temp_{uuid}_{ts}.{ext}`) for the temp*
 * methods, or the full stored path (`file/upload/granted_...`, the same string
 * `FileEntity.filePath` holds) for the rest. The port does not introduce a second
 * naming scheme; `FileService`/`UploadService` keep owning the temp_/granted_
 * transform (ADR 0029 D1).
 */
export interface FileStorage {
  /** Writes a newly attached upload's bytes under its temp key. */
  saveTemp(tempKey: string, data: Buffer): Promise<void>;

  /** ADR 0019 claim precondition — does an unpromoted temp object still exist. */
  existsTemp(tempKey: string): Promise<boolean>;

  /** Promotes a temp object to its granted key (temp_ -> granted_, ADR 0003/0019). */
  promote(tempKey: string, grantedKey: string): Promise<void>;

  /** Byte size of a stored (granted) object, for Content-Length/Range math. */
  stat(key: string): Promise<{ size: number }>;

  /** A readable stream over the object, optionally bounded to a byte range (206). */
  createReadStream(key: string, range?: StorageByteRange): Promise<Readable>;

  /** Best-effort deletion of one or more keys (temp or granted). Never throws per-key. */
  unlink(keys: string[]): Promise<StorageUnlinkResult>;

  /** Lists every temp object with its age, for the orphan sweep (ADR 0018). */
  listTemp(): Promise<StorageTempEntry[]>;

  /** Lists every granted object with its age, for the DB-joined reclaim sweep (ADR 0051). */
  listGranted(): Promise<StorageTempEntry[]>;

  /**
   * A time-limited URL the client can fetch `key` from directly, bypassing the
   * app server (ADR 0036). `null` means the adapter has no such concept —
   * callers fall back to `stat()`/`createReadStream()`. TTL is adapter-internal
   * (read from config at construction), not a parameter here.
   */
  getSignedReadUrl(key: string, contentType: string): Promise<string | null>;
}
