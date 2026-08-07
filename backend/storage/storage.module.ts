// Purpose: wires the FileStorage port to a concrete adapter selected by STORAGE_DRIVER, and exports it to every consuming module.
// Usage: imported by UploadModule, FileModule, UserModule, TempCleanupModule — each injects FILE_STORAGE, never LocalDiskStorage/S3Storage directly.
// Rationale: an operational/infrastructure module (mirrors TempCleanupModule's ADR 0018 precedent) — FileStorage is consumed by three domain modules plus UserModule, so it cannot live inside any one of them (ADR 0029 D2).

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
