// 목적: FileStorage 포트를 STORAGE_DRIVER로 선택된 구체 어댑터에 연결하고, 이를 모든 소비 모듈에 export한다.
// 사용처: UploadModule, FileModule, UserModule, TempCleanupModule이 임포트한다 — 각자 FILE_STORAGE를 주입받을 뿐, LocalDiskStorage/S3Storage를 직접 쓰지 않는다.
// 근거: operational/infrastructure 모듈이다(TempCleanupModule의 ADR 0018 선례와 같다) — FileStorage는 세 도메인 모듈에 UserModule까지 더해 소비하므로, 그중 어느 하나 안에도 둘 수 없다(ADR 0029 D2).

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FILE_STORAGE } from './file-storage.interface';
import { LocalDiskStorage } from './local-disk.storage';
import { S3Storage } from './s3.storage';

@Module({
  providers: [
    {
      provide: FILE_STORAGE,
      useFactory: (configService: ConfigService) => {
        const driver = configService.getOrThrow<string>('STORAGE_DRIVER');
        return driver === 's3'
          ? new S3Storage(configService)
          : new LocalDiskStorage();
      },
      inject: [ConfigService],
    },
  ],
  exports: [FILE_STORAGE],
})
export class StorageModule {}
