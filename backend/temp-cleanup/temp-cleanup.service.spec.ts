import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { TempCleanupService } from './temp-cleanup.service';
import {
  FILE_STORAGE,
  FileStorage,
} from 'backend/storage/file-storage.interface';

jest.mock('cron');

const cronFrom = CronJob.from as unknown as jest.Mock;

// Mutable config the mock ConfigService reads from — reset in beforeEach.
const config = {
  enabled: true,
  cron: '0 * * * *',
  ttlHours: 24,
  dryRun: false,
};

const hoursAgo = (h: number): number => Date.now() - h * 60 * 60 * 1000;

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

  const mockStorage: jest.Mocked<FileStorage> = {
    saveTemp: jest.fn(),
    existsTemp: jest.fn(),
    promote: jest.fn(),
    stat: jest.fn(),
    createReadStream: jest.fn(),
    unlink: jest.fn(),
    listTemp: jest.fn(),
  };

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
        { provide: FILE_STORAGE, useValue: mockStorage },
      ],
    }).compile();

    service = moduleRef.get(TempCleanupService);
  });

  describe('sweep', () => {
    it('deletes only entries the port lists as expired', async () => {
      mockStorage.listTemp.mockResolvedValue([
        { key: 'temp_old.mp4', mtimeMs: hoursAgo(25) },
        { key: 'temp_fresh.mp4', mtimeMs: hoursAgo(1) },
      ]);
      mockStorage.unlink.mockResolvedValue({ deleted: 1, failures: [] });

      await service.sweep();

      expect(mockStorage.unlink).toHaveBeenCalledWith(['temp_old.mp4']);
    });

    it('does not delete anything in dry-run mode', async () => {
      config.dryRun = true;
      mockStorage.listTemp.mockResolvedValue([
        { key: 'temp_old.mp4', mtimeMs: hoursAgo(100) },
      ]);

      await service.sweep();

      expect(mockStorage.unlink).not.toHaveBeenCalled();
    });

    it('does nothing when nothing is expired', async () => {
      mockStorage.listTemp.mockResolvedValue([
        { key: 'temp_fresh.mp4', mtimeMs: hoursAgo(1) },
      ]);

      await service.sweep();

      expect(mockStorage.unlink).not.toHaveBeenCalled();
    });

    it('logs but does not throw when the port reports a failed unlink', async () => {
      mockStorage.listTemp.mockResolvedValue([
        { key: 'temp_a.mp4', mtimeMs: hoursAgo(50) },
      ]);
      mockStorage.unlink.mockResolvedValue({
        deleted: 0,
        failures: [{ key: 'temp_a.mp4', reason: 'EBUSY' }],
      });

      await expect(service.sweep()).resolves.toBeUndefined();
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
