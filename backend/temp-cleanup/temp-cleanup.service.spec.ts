import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import * as fs from 'fs/promises';
import { join } from 'path';
import { TempCleanupService } from './temp-cleanup.service';

jest.mock('fs/promises');
jest.mock('cron');

const readdir = fs.readdir as unknown as jest.Mock;
const stat = fs.stat as unknown as jest.Mock;
const unlink = fs.unlink as unknown as jest.Mock;
const cronFrom = CronJob.from as unknown as jest.Mock;

// Mutable config the mock ConfigService reads from — reset in beforeEach.
const config = {
  enabled: true,
  cron: '0 * * * *',
  ttlHours: 24,
  dryRun: false,
};

const tempPath = (name: string): string =>
  join(process.cwd(), 'file', 'temp', name);

const hoursAgo = (h: number): number => Date.now() - h * 60 * 60 * 1000;

// stat() resolves to a file whose mtime is `h` hours in the past.
const fileStat = (h: number) => ({ isFile: () => true, mtimeMs: hoursAgo(h) });

describe('TempCleanupService', () => {
  let service: TempCleanupService;

  const mockConfigService = {
    get: jest.fn((key: string, def?: unknown) => {
      if (key === 'TEMP_SWEEP_ENABLED') return config.enabled;
      if (key === 'TEMP_SWEEP_DRY_RUN') return config.dryRun;
      return def;
    }),
    getOrThrow: jest.fn((key: string) => {
      if (key === 'TEMP_SWEEP_CRON') return config.cron;
      if (key === 'TEMP_SWEEP_TTL_HOURS') return config.ttlHours;
      throw new Error(`unexpected key ${key}`);
    }),
  };

  const mockSchedulerRegistry = { addCronJob: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    config.enabled = true;
    config.cron = '0 * * * *';
    config.ttlHours = 24;
    config.dryRun = false;

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        TempCleanupService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: SchedulerRegistry, useValue: mockSchedulerRegistry },
      ],
    }).compile();

    service = moduleRef.get(TempCleanupService);
  });

  describe('sweep', () => {
    it('deletes only temp_ files older than the TTL, never touching other entries', async () => {
      readdir.mockResolvedValue([
        'temp_old.mp4',
        'temp_fresh.mp4',
        'granted_keep.mp4',
        'random.txt',
      ]);
      stat.mockImplementation((p: string) =>
        Promise.resolve(p.includes('temp_old') ? fileStat(25) : fileStat(1)),
      );
      unlink.mockResolvedValue(undefined);

      await service.sweep();

      expect(unlink).toHaveBeenCalledTimes(1);
      expect(unlink).toHaveBeenCalledWith(tempPath('temp_old.mp4'));
      // Prefix guard: non-temp_ entries are never even stat'd.
      expect(stat).not.toHaveBeenCalledWith(tempPath('granted_keep.mp4'));
      expect(stat).not.toHaveBeenCalledWith(tempPath('random.txt'));
    });

    it('does not delete anything in dry-run mode', async () => {
      config.dryRun = true;
      readdir.mockResolvedValue(['temp_old.mp4']);
      stat.mockResolvedValue(fileStat(100));

      await service.sweep();

      expect(unlink).not.toHaveBeenCalled();
    });

    it('treats an absent file/temp directory (ENOENT) as an empty no-op', async () => {
      readdir.mockRejectedValue(
        Object.assign(new Error('missing'), { code: 'ENOENT' }),
      );

      await expect(service.sweep()).resolves.toBeUndefined();
      expect(stat).not.toHaveBeenCalled();
      expect(unlink).not.toHaveBeenCalled();
    });

    it('continues sweeping when one unlink fails', async () => {
      readdir.mockResolvedValue(['temp_a.mp4', 'temp_b.mp4']);
      stat.mockResolvedValue(fileStat(50));
      unlink
        .mockRejectedValueOnce(new Error('EBUSY'))
        .mockResolvedValueOnce(undefined);

      await expect(service.sweep()).resolves.toBeUndefined();
      expect(unlink).toHaveBeenCalledTimes(2);
    });

    it('skips a file that vanishes mid-sweep (stat rejects)', async () => {
      readdir.mockResolvedValue(['temp_gone.mp4', 'temp_here.mp4']);
      stat.mockImplementation((p: string) =>
        p.includes('temp_gone')
          ? Promise.reject(new Error('ENOENT'))
          : Promise.resolve(fileStat(50)),
      );
      unlink.mockResolvedValue(undefined);

      await service.sweep();

      expect(unlink).toHaveBeenCalledTimes(1);
      expect(unlink).toHaveBeenCalledWith(tempPath('temp_here.mp4'));
    });
  });

  describe('onModuleInit', () => {
    it('registers and starts a cron job when enabled', () => {
      const fakeJob = { start: jest.fn() };
      cronFrom.mockReturnValue(fakeJob);

      service.onModuleInit();

      expect(cronFrom).toHaveBeenCalledWith(
        expect.objectContaining({ cronTime: '0 * * * *' }),
      );
      expect(mockSchedulerRegistry.addCronJob).toHaveBeenCalledWith(
        'orphan-temp-file-sweep',
        fakeJob,
      );
      expect(fakeJob.start).toHaveBeenCalled();
    });

    it('registers no cron job when disabled', () => {
      config.enabled = false;

      service.onModuleInit();

      expect(cronFrom).not.toHaveBeenCalled();
      expect(mockSchedulerRegistry.addCronJob).not.toHaveBeenCalled();
    });
  });
});
