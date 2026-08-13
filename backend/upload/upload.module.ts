import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { StorageModule } from 'backend/storage/storage.module';

@Module({
  imports: [
    MulterModule.register({
      // Buffers into memory instead of writing to local disk directly — the
      // physical write now happens through the FileStorage port (UploadService),
      // so a driver switch actually reaches temp bytes too (ADR 0029 D4).
      storage: memoryStorage(),
    }),
    StorageModule,
  ],
  controllers: [UploadController],
  providers: [UploadService],
})
export class UploadModule {}
