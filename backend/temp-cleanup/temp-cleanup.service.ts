// Purpose: sweeps orphaned temp_ upload files out of file/temp past a TTL — the only unmanaged resource leak (ADR 0018).
// Usage: provided by TempCleanupModule; registers a dynamic CronJob via SchedulerRegistry on module init.
// Rationale: promotion renames files OUT of file/temp, so anything left is unclaimed — a filesystem-only sweep, no DB.

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { readdir, stat, unlink } from 'fs/promises';
import { join } from 'path';
import {
  selectExpiredTempFiles,
  TempFileStat,
} from './select-expired-temp-files';

// The sweep only ever reads file/temp — the same directory UploadModule writes to.
const TEMP_DIR = join('file', 'temp');
// Unique name so the job is addressable via SchedulerRegistry (start/stop/delete).
const CRON_JOB_NAME = 'orphan-temp-file-sweep';
// Bound unlink parallelism so a large temp/ backlog cannot spawn thousands of
// concurrent fs handles at once (Never Do G1 — resource efficiency on big dirs).
const UNLINK_BATCH_SIZE = 100;

@Injectable()
export class TempCleanupService implements OnModuleInit {
  private readonly logger = new Logger(TempCleanupService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  // Registered imperatively (not via @Cron) so the schedule string comes from
  // config and the job is skipped entirely when disabled (e.g. e2e/test boots).
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

  // Deletes temp_ files in file/temp older than the TTL. Kept public so it can be
  // unit-tested and, later, invoked on demand without waiting for a cron tick.
  async sweep(): Promise<void> {
    const ttlHours = this.configService.getOrThrow<number>(
      'TEMP_SWEEP_TTL_HOURS',
    );
    const dryRun = this.configService.get<boolean>('TEMP_SWEEP_DRY_RUN', false);
    const ttlMs = ttlHours * 60 * 60 * 1000;
    const dir = join(process.cwd(), TEMP_DIR);

    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (error) {
      // An absent file/temp is a normal empty state (nothing uploaded yet) — not an error.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      this.logger.error(
        `Orphan temp-file sweep could not read ${TEMP_DIR}.`,
        error instanceof Error ? error.stack : String(error),
      );
      return;
    }

    // First guard: never even stat a non-temp_ entry (granted_ never lives here,
    // but the prefix check keeps the sweep blind to anything it must not touch).
    const candidates: TempFileStat[] = [];
    for (const name of entries) {
      if (!name.startsWith('temp_')) continue;
      try {
        const info = await stat(join(dir, name));
        if (info.isFile()) candidates.push({ name, mtimeMs: info.mtimeMs });
      } catch {
        // A file vanishing mid-sweep (a concurrent promotion rename) is benign — skip it.
        continue;
      }
    }

    // Second guard: the pure selector re-checks the temp_ prefix and the TTL.
    const expired = selectExpiredTempFiles(candidates, Date.now(), ttlMs);
    if (expired.length === 0) return;

    if (dryRun) {
      this.logger.log(
        `Orphan temp-file sweep (dry-run): ${expired.length} file(s) would be deleted: ${expired.join(', ')}`,
      );
      return;
    }

    let deleted = 0;
    for (let i = 0; i < expired.length; i += UNLINK_BATCH_SIZE) {
      const batch = expired.slice(i, i + UNLINK_BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map((name) => unlink(join(dir, name))),
      );
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          deleted += 1;
        } else {
          // One failed unlink must not abort the whole sweep — log and continue.
          const reason: unknown = result.reason;
          this.logger.warn(
            `Orphan temp-file sweep could not delete ${batch[index]}: ${reason instanceof Error ? reason.message : String(reason)}`,
          );
        }
      });
    }
    this.logger.log(`Orphan temp-file sweep deleted ${deleted} file(s).`);
  }
}
