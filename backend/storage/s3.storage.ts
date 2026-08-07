// Purpose: FileStorage adapter backed by S3 — the concrete answer to ADR 0005's multi-instance gap, built ahead of any real bucket (ADR 0029).
// Usage: constructed by StorageModule's factory when STORAGE_DRIVER=s3; verified only by unit tests against a mocked S3Client until Stage 4's cutover.
// Rationale: S3 is the ISP-required second FileStorage implementation — without it the port interface would have no real second consumer to justify itself.

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import {
  FileStorage,
  StorageByteRange,
  StorageTempEntry,
  StorageUnlinkResult,
} from './file-storage.interface';

const UPLOAD_PREFIX = 'file/upload/';
// S3's DeleteObjects API caps a single request at 1000 keys.
const DELETE_BATCH_SIZE = 1000;

@Injectable()
export class S3Storage implements FileStorage {
  private readonly logger = new Logger(S3Storage.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(configService: ConfigService) {
    // No explicit credentials: the SDK's default provider chain (env vars, shared
    // config, IAM role) resolves them — this app's ConfigService never reads
    // AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY itself (ADR 0029 D3).
    this.client = new S3Client({
      region: configService.getOrThrow<string>('AWS_REGION'),
    });
    this.bucket = configService.getOrThrow<string>('S3_BUCKET');
  }

  // 목적: 첨부 직후 temp 바이트를 버킷에 올린다.
  // 이유: UploadService가 받은 버퍼를 다음 청구 단계 전에 인스턴스 무관하게 영속화해야 한다(ADR 0029 D4).
  // 방법: PutObjectCommand로 키 그대로 업로드한다.
  async saveTemp(tempKey: string, data: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: tempKey, Body: data }),
    );
  }

  // 목적: ADR 0019 청구 전제조건 — temp 객체가 아직 승격되지 않은 채 남아 있는지 확인한다.
  // 이유: 로컬 어댑터의 access() 판정과 동일한 계약(존재 확인 실패는 전부 false)을 유지해야 uploadFile의 400 분기가 어댑터에 무관하게 동작한다.
  // 방법: HeadObjectCommand 성공 여부만 boolean으로 좁힌다 — 에러 종류를 구분하지 않는다(로컬 어댑터와 동일한 관대함).
  async existsTemp(tempKey: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: tempKey }),
      );
      return true;
    } catch {
      return false;
    }
  }

  // 목적: temp 객체를 granted 키로 승격한다(temp_ -> granted_, ADR 0003).
  // 이유: S3는 원자적 rename이 없으므로 copy 후 원본 삭제로 같은 의미를 낸다.
  // 방법: CopyObjectCommand로 복사한 뒤 DeleteObjectCommand로 temp 원본을 지운다 — 복사가 실패하면 원본은 그대로 남는다.
  async promote(tempKey: string, grantedKey: string): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${encodeURIComponent(tempKey)}`,
        Key: grantedKey,
      }),
    );
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: tempKey }),
    );
  }

  // 목적: 저장된 객체의 바이트 크기를 돌려준다.
  // 이유: Content-Length 헤더와 Range 파싱에 크기가 필요하다.
  // 방법: HeadObjectCommand의 ContentLength를 좁혀서 반환한다.
  async stat(key: string): Promise<{ size: number }> {
    const response = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return { size: response.ContentLength ?? 0 };
  }

  // 목적: 저장된 객체를 읽는 스트림을 만든다, 필요하면 바이트 범위로 제한한다.
  // 이유: 비디오/오디오 탐색(seek)이 Range 요청에 의존한다(ADR 0025/0026) — 로컬 어댑터와 같은 계약.
  // 방법: GetObjectCommand에 Range 헤더를 실어 보내고, 응답 Body를 Readable로 좁혀 반환한다(SDK는 Node에서 Readable을 준다).
  async createReadStream(
    key: string,
    range?: StorageByteRange,
  ): Promise<Readable> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(range && { Range: `bytes=${range.start}-${range.end}` }),
      }),
    );

    if (!(response.Body instanceof Readable)) {
      throw new Error(`S3 object body for ${key} was not a Node stream.`);
    }
    return response.Body;
  }

  // 목적: 저장 경로 목록의 객체를 지우고, 남은 것은 실패 목록으로 드러낸다.
  // 이유: unlink 실패가 이미 확정된 DB 삭제를 되돌릴 수는 없으므로, 조용히 새는 대신 관측 가능해야 한다(ADR 0020).
  // 방법: granted(file/upload/ 접두) 또는 temp(temp_ 접두) 키만 대상으로 삼아 최대 1000개씩 DeleteObjectsCommand로 지운다.
  async unlink(keys: string[]): Promise<StorageUnlinkResult> {
    const result: StorageUnlinkResult = { deleted: 0, failures: [] };

    const targets = keys.filter((key) => {
      if (key.startsWith(UPLOAD_PREFIX) || key.startsWith('temp_')) {
        return true;
      }
      result.failures.push({ key, reason: 'not a recognized storage key' });
      return false;
    });

    for (let i = 0; i < targets.length; i += DELETE_BATCH_SIZE) {
      const batch = targets.slice(i, i + DELETE_BATCH_SIZE);
      try {
        const response = await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: batch.map((key) => ({ Key: key })) },
          }),
        );
        const failedKeys = new Set(
          (response.Errors ?? []).map((error) => error.Key),
        );
        for (const key of batch) {
          if (failedKeys.has(key)) continue;
          result.deleted += 1;
        }
        for (const error of response.Errors ?? []) {
          result.failures.push({
            key: error.Key ?? 'unknown',
            reason: error.Message ?? 'unknown S3 delete error',
          });
        }
      } catch (error) {
        for (const key of batch) {
          result.failures.push({
            key,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return result;
  }

  // 목적: 버킷의 모든 temp 객체와 나이를 나열한다(ADR 0018 고아 스윕용).
  // 이유: 스윕이 만료 여부를 판정하려면 각 객체의 마지막 수정 시각이 필요하다.
  // 방법: ListObjectsV2Command를 Prefix 'temp_'로 페이지네이션하며 Key/LastModified를 모은다.
  async listTemp(): Promise<StorageTempEntry[]> {
    const result: StorageTempEntry[] = [];
    let continuationToken: string | undefined;

    do {
      let response: ListObjectsV2CommandOutput;
      try {
        response = await this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: 'temp_',
            ContinuationToken: continuationToken,
          }),
        );
      } catch (error) {
        this.logger.error(
          'Could not list temp objects in S3.',
          error instanceof Error ? error.stack : String(error),
        );
        return result;
      }

      for (const object of response.Contents ?? []) {
        if (!object.Key || !object.LastModified) continue;
        result.push({
          key: object.Key,
          mtimeMs: object.LastModified.getTime(),
        });
      }
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return result;
  }
}
