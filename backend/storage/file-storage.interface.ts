// Purpose: defines the FileStorage port — every physical-file operation the app performs, isolated from the local-disk/S3 mechanics behind it.
// Usage: consumers (UploadService, FileService, FileContentController, TempCleanupService, UserService) inject FILE_STORAGE and call these methods, never fs/promises directly.
// Rationale: ADR 0005's "no deploy target" premise is gone (ROADMAP §4); a swappable adapter is the precondition for S3-backed multi-instance deploys (ADR 0029).

import { Readable } from 'stream';

// No runtime representation for a TS interface — Nest needs a token to inject by.
export const FILE_STORAGE = Symbol('FILE_STORAGE');

export interface StorageByteRange {
  start: number;
  end: number;
}

export interface StorageUnlinkResult {
  deleted: number;
  // One entry per key that stayed in storage; callers log these at warn (ADR 0017).
  failures: { key: string; reason: string }[];
}

export interface StorageTempEntry {
  key: string;
  /** Last-modified time in epoch milliseconds — the orphan sweep's age signal (ADR 0018). */
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

  /**
   * A time-limited URL the client can fetch `key` from directly, bypassing the
   * app server (ADR 0036). `null` means the adapter has no such concept —
   * callers fall back to `stat()`/`createReadStream()`. TTL is adapter-internal
   * (read from config at construction), not a parameter here.
   */
  getSignedReadUrl(key: string, contentType: string): Promise<string | null>;
}
