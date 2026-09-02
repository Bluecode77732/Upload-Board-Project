// Purpose: sweeps orphaned temp_ upload objects past a TTL — the only unmanaged resource leak (ADR 0018).
// Usage: provided by TempCleanupModule; registers a dynamic CronJob via SchedulerRegistry on module init.
// Rationale: promotion moves objects OUT of the temp namespace, so anything left is unclaimed. Reads/deletes go through the FileStorage port (ADR 0029) so the sweep works under either adapter.

import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { selectExpiredTempFiles } from './select-expired-temp-files';
import {
  FILE_STORAGE,
  type FileStorage,
} from 'backend/storage/file-storage.interface';
import { MetricsService } from 'backend/metrics/metrics.service';

// Unique name so the job is addressable via SchedulerRegistry (start/stop/delete).
const CRON_JOB_NAME = 'orphan-temp-file-sweep';

@Injectable()
export class TempCleanupService implements OnModuleInit {
  private readonly logger = new Logger(TempCleanupService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,

    @Inject(FILE_STORAGE)
    private readonly storage: FileStorage,

    private readonly metricsService: MetricsService,
  ) {}

  // 목적: 모듈 초기화 시 고아 temp 파일 스윕 크론 잡을 등록하고 시작한다.
  // 이유: @Cron 데코레이터는 스케줄 문자열을 컴파일 시점 리터럴로 고정시키는데, 이 값은
  //       TEMP_SWEEP_CRON env var에서 와야 하고 e2e/test 부팅에서는 아예 등록을 건너뛸 수
  //       있어야 한다 — 둘 다 명령형 SchedulerRegistry 등록으로만 표현 가능하다.
  // 방법: TEMP_SWEEP_ENABLED가 false면 등록 없이 반환. 아니면 TEMP_SWEEP_CRON으로 CronJob을
  //       만들어 SchedulerRegistry에 등록 후 시작 — onTick에서 sweep()의 예외를 .catch로
  //       흡수해 unhandledRejection이 되지 않게 하고, waitForCompletion으로 이전 스윕이 아직
  //       돌고 있으면 겹치지 않고 이번 틱을 건너뛴다.
  onModuleInit(): void {
    const enabled = this.configService.get<boolean>('TEMP_SWEEP_ENABLED', true);
    if (!enabled) {
      this.logger.log(
        'Orphan temp-file sweep disabled (TEMP_SWEEP_ENABLED=false); no cron registered.',
      );
      return;
    }

    const cronTime = this.configService.getOrThrow<string>('TEMP_SWEEP_CRON');
    const job = CronJob.from({
      cronTime,
      // Errors are handled inside sweep(); .catch() guards against an unexpected
      // throw becoming an unhandledRejection (Never Do G1 — floating promise).
      onTick: () => {
        this.sweep().catch((error) =>
          this.logger.error(
            'Orphan temp-file sweep threw unexpectedly.',
            error instanceof Error ? error.stack : String(error),
          ),
        );
      },
      // Skip a tick rather than overlap if a previous sweep is still running.
      waitForCompletion: true,
    });

    this.schedulerRegistry.addCronJob(CRON_JOB_NAME, job);
    job.start();
    this.logger.log(`Orphan temp-file sweep scheduled (cron: ${cronTime}).`);
  }

  // 목적: TTL을 넘긴 temp_ 객체를 지운다(ADR 0018). 크론 없이도 단위 테스트/수동 호출이 가능하도록 public.
  // 이유: file/temp를 직접 readdir/stat/unlink하던 기존 구현은 로컬 디스크에 고정돼 있어, STORAGE_DRIVER=s3에서
  //       조용히 아무것도 스윕하지 않게 된다(ADR 0029 D5) — 포트를 거치면 두 어댑터에서 동일하게 동작한다.
  // 방법: storage.listTemp()로 후보를 받아(각 어댑터가 이미 temp_ 접두만 반환) 순수 선택기로 만료분을 고르고,
  //       dry-run이 아니면 storage.unlink()에 위임한다 — 배치/가드는 어댑터 책임이므로 여기서 중복하지 않는다.
  //       실제로 삭제된 개수만 temp_cleanup_deleted_total에 더한다(dry-run은 관측 대상 아님, ADR 0047).
  async sweep(): Promise<void> {
    const ttlHours = this.configService.getOrThrow<number>(
      'TEMP_SWEEP_TTL_HOURS',
    );
    const dryRun = this.configService.get<boolean>('TEMP_SWEEP_DRY_RUN', false);
    const ttlMs = ttlHours * 60 * 60 * 1000;

    const candidates = await this.storage.listTemp();

    // The pure selector re-checks the temp_ prefix and the TTL.
    const expired = selectExpiredTempFiles(candidates, Date.now(), ttlMs);
    if (expired.length === 0) return;

    if (dryRun) {
      this.logger.log(
        `Orphan temp-file sweep (dry-run): ${expired.length} object(s) would be deleted: ${expired.join(', ')}`,
      );
      return;
    }

    const { deleted, failures } = await this.storage.unlink(expired);
    for (const failure of failures) {
      // One failed unlink must not abort the whole sweep — log and continue.
      this.logger.warn(
        `Orphan temp-file sweep could not delete ${failure.key}: ${failure.reason}`,
      );
    }
    if (deleted > 0) {
      this.metricsService.tempCleanupDeletedTotal.inc(deleted);
    }
    this.logger.log(`Orphan temp-file sweep deleted ${deleted} object(s).`);
  }
}
