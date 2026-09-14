import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { ScanService } from './scan.service';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { StorageModule } from 'backend/storage/storage.module';

@Module({
  imports: [
    MulterModule.register({
      // 로컬 디스크에 직접 쓰는 대신 메모리에 버퍼링한다 — 실제 물리 쓰기는 이제
      // FileStorage 포트(UploadService)를 거치므로, 드라이버를 바꾸면 temp 바이트에도
      // 실제로 영향이 미친다(ADR 0029 D4).
      storage: memoryStorage(),
    }),
    StorageModule,
  ],
  controllers: [UploadController],
  // ScanService는 다른 모듈이 쓸 일이 없는 UploadModule 전용 provider다(ADR 0059 D2) —
  // FileStorage처럼 여러 도메인 모듈이 공유하는 게 아니라서 별도 모듈로 빼지 않는다.
  providers: [UploadService, ScanService],
})
export class UploadModule {}
