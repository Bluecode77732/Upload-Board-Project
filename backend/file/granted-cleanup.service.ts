// 목적: 고아 granted_ 객체 — file_entity 행이 없는 file/upload 바이트 — 를 찾아 정리하려고 훑는다(ADR 0051).
// 사용처: FileModule의 export하지 않는 provider다; 모듈 초기화 시 SchedulerRegistry로 동적 CronJob을 등록한다.
// 이유: FileModule 안에 산다(TempCleanupModule과 달리 별도 operational 모듈이 아니다) — 하는 일 전부가 FileModule 자신의 엔티티를 디스크와 대조하는 것이고, FileModule은 이미 리포지토리·StorageModule·MetricsModule을 다 갖고 있어 새 모듈 배선이 필요 없기 때문이다.

import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { Repository } from 'typeorm';
import { FileEntity } from './entity/file.entity';
import { selectOrphanedGrantedFiles } from './select-orphaned-granted-files';
import {
  FILE_STORAGE,
  type FileStorage,
} from 'backend/storage/file-storage.interface';
import { MetricsService } from 'backend/metrics/metrics.service';

const CRON_JOB_NAME = 'orphan-granted-file-sweep';

// 승격 레이스를 막기 위한 가드일 뿐, 운영자가 조정할 값이 아니다(진짜 운영 판단이 필요한
// TEMP_SWEEP_TTL_HOURS와 다르다) — storage.promote()의 통상 1초 미만 소요 시간보다
// 넉넉히 잡았으므로, 이 코드베이스 안에서 값을 바꿀 일이 없는 상수로 둔다(ADR 0051 D3).
const MIN_AGE_MS = 60 * 60 * 1000;

@Injectable()
export class GrantedCleanupService implements OnModuleInit {
  private readonly logger = new Logger(GrantedCleanupService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,

    @InjectRepository(FileEntity)
    private readonly fileRepository: Repository<FileEntity>,

    @Inject(FILE_STORAGE)
    private readonly storage: FileStorage,

    private readonly metricsService: MetricsService,
  ) {}

  // 목적: 모듈 초기화 시 고아 granted 파일을 훑는 크론 잡을 등록하고 시작한다.
  // 이유: TempCleanupService와 같은 이유다 — 스케줄 문자열이 config(GRANTED_SWEEP_CRON)에서
  //       와야 하고 비활성화 시엔 등록 자체를 건너뛰어야 하는데, 둘 다 @Cron 데코레이터로는
  //       표현할 수 없다.
  // 방법: GRANTED_SWEEP_ENABLED가 false면 등록 없이 반환한다. 아니면 GRANTED_SWEEP_CRON으로
  //       CronJob을 만들어 SchedulerRegistry에 등록하고 시작한다 — onTick에서 sweep()의
  //       예외를 .catch로 흡수해 unhandledRejection이 되지 않게 하고, waitForCompletion으로
  //       이전에 훑던 게 아직 돌고 있으면 이번 틱을 건너뛴다.
  onModuleInit(): void {
    const enabled = this.configService.get<boolean>(
      'GRANTED_SWEEP_ENABLED',
      true,
    );
    if (!enabled) {
      this.logger.log(
        'Orphan granted-file sweep disabled (GRANTED_SWEEP_ENABLED=false); no cron registered.',
      );
      return;
    }

    const cronTime =
      this.configService.getOrThrow<string>('GRANTED_SWEEP_CRON');
    const job = CronJob.from({
      cronTime,
      onTick: () => {
        this.sweep().catch((error) =>
          this.logger.error(
            'Orphan granted-file sweep threw unexpectedly.',
            error instanceof Error ? error.stack : String(error),
          ),
        );
      },
      waitForCompletion: true,
    });

    this.schedulerRegistry.addCronJob(CRON_JOB_NAME, job);
    job.start();
    this.logger.log(`Orphan granted-file sweep scheduled (cron: ${cronTime}).`);
  }

  // 목적: DB에 없는 granted_ 객체를 찾아서, 기본값으로는 리포트만 하고 필요할 때만 지운다(ADR 0051).
  //       크론 없이도 단위 테스트나 수동 호출이 가능하도록 public으로 둔다.
  // 이유: granted 파일의 고아 여부는 파일명만으론 알 수 없다 — file_entity.filePath와 대조해야
  //       한다. 기본값이 dry-run(true)이라, 판정 로직이 검증되기 전까진 실제 삭제가 일어나지 않는다.
  // 방법: fileRepository에서 filePath 컬럼만 읽어 Set을 만들고, storage.listGranted() 후보를
  //       순수 선택기에 넘겨 고아만 고른다. dry-run이면 찾은 개수만 메트릭에 남기고 끝내고,
  //       아니면 storage.unlink()에 위임해 실제로 삭제된 개수만 outcome=deleted로 따로 더한다.
  async sweep(): Promise<void> {
    const dryRun = this.configService.get<boolean>(
      'GRANTED_SWEEP_DRY_RUN',
      true,
    );

    const [candidates, knownFiles] = await Promise.all([
      this.storage.listGranted(),
      this.fileRepository.find({ select: ['filePath'] }),
    ]);
    const knownFilePaths = new Set(knownFiles.map((f) => f.filePath));

    const orphaned = selectOrphanedGrantedFiles(
      candidates,
      knownFilePaths,
      Date.now(),
      MIN_AGE_MS,
    );
    if (orphaned.length === 0) return;

    this.metricsService.grantedCleanupSweepTotal.inc(
      { outcome: 'candidate' },
      orphaned.length,
    );

    if (dryRun) {
      this.logger.log(
        `Orphan granted-file sweep (dry-run): ${orphaned.length} object(s) would be deleted: ${orphaned.join(', ')}`,
      );
      return;
    }

    const { deleted, failures } = await this.storage.unlink(orphaned);
    for (const failure of failures) {
      this.logger.warn(
        `Orphan granted-file sweep could not delete ${failure.key}: ${failure.reason}`,
      );
    }
    if (deleted > 0) {
      this.metricsService.grantedCleanupSweepTotal.inc(
        { outcome: 'deleted' },
        deleted,
      );
    }
    this.logger.log(`Orphan granted-file sweep deleted ${deleted} object(s).`);
  }
}
