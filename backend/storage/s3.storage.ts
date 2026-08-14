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
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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
// Physical S3 bucket layout only (a console-organization decision, not a port
// contract change) — logical keys (temp_..., file/upload/granted_...) stay the
// app-wide naming scheme FileService/UploadService own (ADR 0029 D1); this
// adapter alone maps them onto two S3 prefixes so temp/granted objects sit in
// separate top-level "folders" in the bucket.
const S3_TEMP_PREFIX = 'temp/';
const S3_GRANTED_PREFIX = 'granted/';

@Injectable()
export class S3Storage implements FileStorage {
  private readonly logger = new Logger(S3Storage.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly signedUrlTtlSeconds: number;

  constructor(configService: ConfigService) {
    // No explicit credentials: the SDK's default provider chain (env vars, shared
    // config, IAM role) resolves them — this app's ConfigService never reads
    // AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY itself (ADR 0029 D3).
    this.client = new S3Client({
      region: configService.getOrThrow<string>('AWS_REGION'),
    });
    this.bucket = configService.getOrThrow<string>('S3_BUCKET');
    // Read once at construction, not per call — TTL is an adapter-internal
    // concern the controller never sees (ADR 0036 D1).
    this.signedUrlTtlSeconds = configService.getOrThrow<number>(
      'CONTENT_SIGNED_URL_TTL_SECONDS',
    );
  }

  // 목적: temp 논리 키(temp_...)를 S3 물리 key로 변환한다.
  // 이유: 버킷 안에서 temp/granted 객체를 별도 폴더로 구분해야 한다는 요구로 물리 레이아웃만 분리했다 — 논리 키 자체(FileService/UploadService 계약)는 바꾸지 않는다.
  // 방법: 'temp/' 접두를 붙인다.
  private toS3TempKey(tempKey: string): string {
    return `${S3_TEMP_PREFIX}${tempKey}`;
  }

  // 목적: granted 논리 키(file/upload/granted_...)를 S3 물리 key로 변환한다.
  // 이유: 위와 동일 — FileEntity.filePath / 로컬 어댑터가 쓰는 문자열은 그대로 두고 S3 상의 실제 오브젝트 경로만 재배치한다.
  // 방법: 'file/upload/' 접두를 떼고 'granted/'로 바꿔 붙인다.
  private toS3GrantedKey(grantedKey: string): string {
    return `${S3_GRANTED_PREFIX}${grantedKey.slice(UPLOAD_PREFIX.length)}`;
  }

  // 목적: unlink/listTemp처럼 temp·granted 키가 섞여 들어오는 자리에서 논리 키를 물리 key로 판별 변환한다.
  // 이유: 어느 변환을 써야 할지는 키 접두(file/upload/ 또는 temp_)로만 판별 가능하다 — 기존 unlink()의 인식 기준과 동일.
  // 방법: file/upload/ 접두면 toS3GrantedKey, temp_ 접두면 toS3TempKey, 둘 다 아니면 null(미인식 키).
  private toS3Key(logicalKey: string): string | null {
    if (logicalKey.startsWith(UPLOAD_PREFIX)) {
      return this.toS3GrantedKey(logicalKey);
    }
    if (logicalKey.startsWith('temp_')) {
      return this.toS3TempKey(logicalKey);
    }
    return null;
  }

  // 목적: 첨부 직후 temp 바이트를 버킷에 올린다.
  // 이유: UploadService가 받은 버퍼를 다음 청구 단계 전에 인스턴스 무관하게 영속화해야 한다(ADR 0029 D4).
  // 방법: PutObjectCommand로 물리 key(temp/ 폴더)에 업로드한다.
  async saveTemp(tempKey: string, data: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.toS3TempKey(tempKey),
        Body: data,
      }),
    );
  }

  // 목적: ADR 0019 청구 전제조건 — temp 객체가 아직 승격되지 않은 채 남아 있는지 확인한다.
  // 이유: 로컬 어댑터의 access() 판정과 동일한 계약(존재 확인 실패는 전부 false)을 유지해야 uploadFile의 400 분기가 어댑터에 무관하게 동작한다.
  // 방법: 물리 key(temp/ 폴더)로 HeadObjectCommand를 보내 성공 여부만 boolean으로 좁힌다 — 에러 종류를 구분하지 않는다(로컬 어댑터와 동일한 관대함).
  async existsTemp(tempKey: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: this.toS3TempKey(tempKey),
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  // 목적: temp 객체를 granted 키로 승격한다(temp_ -> granted_, ADR 0003).
  // 이유: S3는 원자적 rename이 없으므로 copy 후 원본 삭제로 같은 의미를 낸다.
  // 방법: 두 물리 key(temp/, granted/)로 변환한 뒤 CopyObjectCommand로 복사하고 DeleteObjectCommand로 temp 원본을 지운다 — 복사가 실패하면 원본은 그대로 남는다.
  async promote(tempKey: string, grantedKey: string): Promise<void> {
    const s3TempKey = this.toS3TempKey(tempKey);
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${encodeURIComponent(s3TempKey)}`,
        Key: this.toS3GrantedKey(grantedKey),
      }),
    );
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: s3TempKey }),
    );
  }

  // 목적: 저장된 객체의 바이트 크기를 돌려준다.
  // 이유: Content-Length 헤더와 Range 파싱에 크기가 필요하다.
  // 방법: 물리 key(granted/ 폴더)로 HeadObjectCommand를 보내 ContentLength를 좁혀서 반환한다.
  async stat(key: string): Promise<{ size: number }> {
    const response = await this.client.send(
      new HeadObjectCommand({
        Bucket: this.bucket,
        Key: this.toS3GrantedKey(key),
      }),
    );
    return { size: response.ContentLength ?? 0 };
  }

  // 목적: 저장된 객체를 읽는 스트림을 만든다, 필요하면 바이트 범위로 제한한다.
  // 이유: 비디오/오디오 탐색(seek)이 Range 요청에 의존한다(ADR 0025/0026) — 로컬 어댑터와 같은 계약.
  // 방법: 물리 key(granted/ 폴더)로 GetObjectCommand에 Range 헤더를 실어 보내고, 응답 Body를 Readable로 좁혀 반환한다(SDK는 Node에서 Readable을 준다).
  async createReadStream(
    key: string,
    range?: StorageByteRange,
  ): Promise<Readable> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.toS3GrantedKey(key),
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
  // 방법: 각 논리 key를 물리 key(temp/ 또는 granted/)로 변환해 최대 1000개씩 DeleteObjectsCommand로 지운다 — 호출자·로그에는 원래 논리 key를 그대로 돌려준다.
  async unlink(keys: string[]): Promise<StorageUnlinkResult> {
    const result: StorageUnlinkResult = { deleted: 0, failures: [] };

    const targets: { key: string; s3Key: string }[] = [];
    for (const key of keys) {
      const s3Key = this.toS3Key(key);
      if (s3Key) {
        targets.push({ key, s3Key });
      } else {
        result.failures.push({ key, reason: 'not a recognized storage key' });
      }
    }

    for (let i = 0; i < targets.length; i += DELETE_BATCH_SIZE) {
      const batch = targets.slice(i, i + DELETE_BATCH_SIZE);
      const logicalKeyByS3Key = new Map(
        batch.map((target) => [target.s3Key, target.key]),
      );
      try {
        const response = await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: batch.map((target) => ({ Key: target.s3Key })) },
          }),
        );
        const failedS3Keys = new Set(
          (response.Errors ?? []).map((error) => error.Key),
        );
        for (const target of batch) {
          if (failedS3Keys.has(target.s3Key)) continue;
          result.deleted += 1;
        }
        for (const error of response.Errors ?? []) {
          result.failures.push({
            key: (error.Key && logicalKeyByS3Key.get(error.Key)) ?? 'unknown',
            reason: error.Message ?? 'unknown S3 delete error',
          });
        }
      } catch (error) {
        for (const target of batch) {
          result.failures.push({
            key: target.key,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return result;
  }

  // 목적: 버킷의 모든 temp 객체와 나이를 나열한다(ADR 0018 고아 스윕용).
  // 이유: 스윕이 만료 여부를 판정하려면 각 객체의 마지막 수정 시각이 필요하다 — 반환하는 key는 호출자(TempCleanupService)가 이미 알던 논리 key(temp_...) 형태여야 unlink()에 그대로 되먹일 수 있다.
  // 방법: ListObjectsV2Command를 물리 Prefix 'temp/'로 페이지네이션해 모으고, 각 Key에서 그 접두를 떼어 논리 key로 돌려준다.
  async listTemp(): Promise<StorageTempEntry[]> {
    const result: StorageTempEntry[] = [];
    let continuationToken: string | undefined;

    do {
      let response: ListObjectsV2CommandOutput;
      try {
        response = await this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: S3_TEMP_PREFIX,
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
          key: object.Key.slice(S3_TEMP_PREFIX.length),
          mtimeMs: object.LastModified.getTime(),
        });
      }
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return result;
  }

  // 목적: 앱 서버를 거치지 않고 클라이언트가 S3에서 직접 바이트를 받아갈 수 있는 서명 URL을 만든다.
  // 이유: 프록시 스트리밍은 바이트마다 앱 서버의 대역폭·CPU를 소모한다 — S3를 도입한
  //       본래 목적(대역폭 이전)을 실제로 달성하려면 리다이렉트가 필요하다(ADR 0036).
  // 방법: 물리 key(granted/ 폴더)로 GetObjectCommand에 ResponseContentType을 실어 presigned URL을 생성한다 — 네트워크
  //       왕복 없는 로컬 SigV4 서명이며, TTL은 생성 시점에 읽어 둔 값을 그대로 쓴다.
  async getSignedReadUrl(key: string, contentType: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.toS3GrantedKey(key),
        ResponseContentType: contentType,
      }),
      { expiresIn: this.signedUrlTtlSeconds },
    );
  }
}
