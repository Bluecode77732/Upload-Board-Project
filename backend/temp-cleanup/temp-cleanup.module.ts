// 목적: 스케줄된 고아 temp 파일 스윕을 담는다 — 도메인 모듈이 아니라 operational cross-cutting 모듈이다(ADR 0018).
// 사용처: AppModule이 임포트한다; TempCleanupService를 소유한다(초기화 시 스스로 CronJob을 등록한다).
// 근거: UploadModule 자신의 관심사를 temp 쓰기 스테이징으로 좁게 유지한다; 스윕은 독립된 유지보수
// 책임으로 분리한다(SRP). StorageModule을 임포트해 어느 FileStorage 어댑터에서든 스윕이 동작한다(ADR 0029).

import { Module } from '@nestjs/common';
import { TempCleanupService } from './temp-cleanup.service';
import { StorageModule } from 'backend/storage/storage.module';
import { MetricsModule } from 'backend/metrics/metrics.module';

@Module({
  imports: [StorageModule, MetricsModule],
  providers: [TempCleanupService],
})
export class TempCleanupModule {}
