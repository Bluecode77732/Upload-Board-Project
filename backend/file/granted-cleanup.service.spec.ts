import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { GrantedCleanupService } from './granted-cleanup.service';
import { FileEntity } from './entity/file.entity';
import {
  FILE_STORAGE,
  FileStorage,
} from 'backend/storage/file-storage.interface';
import { MetricsService } from 'backend/metrics/metrics.service';

jest.mock('cron');

const cronFrom = CronJob.from as unknown as jest.Mock;

const config = {
  enabled: true,
  cron: '0 0 * * *',
  dryRun: true,
};

const minutesAgo = (m: number): number => Date.now() - m * 60 * 1000;

describe('GrantedCleanupService', () => {
  let service: GrantedCleanupService;

  const mockConfigService = {
    get: jest.fn((key: string, def?: unknown) => {
      if (key === 'GRANTED_SWEEP_ENABLED') return config.enabled;
      if (key === 'GRANTED_SWEEP_DRY_RUN') return config.dryRun;
      return def;
    }),
    getOrThrow: jest.fn((key: string) => {
      if (key === 'GRANTED_SWEEP_CRON') return config.cron;
      throw new Error(`unexpected key ${key}`);
    }),
  };

  const mockSchedulerRegistry = { addCronJob: jest.fn() };

  const mockMetricsService = {
    grantedCleanupSweepTotal: { inc: jest.fn() },
  };

  const mockFileRepository = { find: jest.fn() };

  const mockStorage: jest.Mocked<FileStorage> = {
    saveTemp: jest.fn(),
    existsTemp: jest.fn(),
    promote: jest.fn(),
    stat: jest.fn(),
    createReadStream: jest.fn(),
    unlink: jest.fn(),
    listTemp: jest.fn(),
    listGranted: jest.fn(),
    getSignedReadUrl: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    config.enabled = true;
    config.cron = '0 0 * * *';
    config.dryRun = true;
    mockFileRepository.find.mockResolvedValue([]);

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        GrantedCleanupService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: SchedulerRegistry, useValue: mockSchedulerRegistry },
        {
          provide: getRepositoryToken(FileEntity),
          useValue: mockFileRepository,
        },
        { provide: FILE_STORAGE, useValue: mockStorage },
        { provide: MetricsService, useValue: mockMetricsService },
      ],
    }).compile();

    service = moduleRef.get(GrantedCleanupService);
  });

  describe('sweep', () => {
    it('reports but does not delete in the default dry-run mode', async () => {
      mockStorage.listGranted.mockResolvedValue([
        { key: 'file/upload/granted_orphan.mp4', mtimeMs: minutesAgo(120) },
      ]);

      await service.sweep();

      expect(mockStorage.unlink).not.toHaveBeenCalled();
      expect(
        mockMetricsService.grantedCleanupSweepTotal.inc,
      ).toHaveBeenCalledWith({ outcome: 'candidate' }, 1);
      expect(
        mockMetricsService.grantedCleanupSweepTotal.inc,
      ).not.toHaveBeenCalledWith({ outcome: 'deleted' }, expect.anything());
    });

    it('deletes only keys absent from the DB once dry-run is off', async () => {
      config.dryRun = false;
      mockFileRepository.find.mockResolvedValue([
        { filePath: 'file/upload/granted_owned.mp4' },
      ]);
      mockStorage.listGranted.mockResolvedValue([
        { key: 'file/upload/granted_owned.mp4', mtimeMs: minutesAgo(120) },
        { key: 'file/upload/granted_orphan.mp4', mtimeMs: minutesAgo(120) },
      ]);
      mockStorage.unlink.mockResolvedValue({ deleted: 1, failures: [] });

      await service.sweep();

      expect(mockStorage.unlink).toHaveBeenCalledWith([
        'file/upload/granted_orphan.mp4',
      ]);
      expect(
        mockMetricsService.grantedCleanupSweepTotal.inc,
      ).toHaveBeenCalledWith({ outcome: 'deleted' }, 1);
    });

    it('does not select a candidate younger than the age floor (promotion-race guard)', async () => {
      mockStorage.listGranted.mockResolvedValue([
        { key: 'file/upload/granted_fresh.mp4', mtimeMs: minutesAgo(1) },
      ]);

      await service.sweep();

      expect(mockStorage.unlink).not.toHaveBeenCalled();
      expect(
        mockMetricsService.grantedCleanupSweepTotal.inc,
      ).not.toHaveBeenCalled();
    });

    it('logs but does not throw when the port reports a failed unlink', async () => {
      config.dryRun = false;
      mockStorage.listGranted.mockResolvedValue([
        { key: 'file/upload/granted_a.mp4', mtimeMs: minutesAgo(120) },
      ]);
      mockStorage.unlink.mockResolvedValue({
        deleted: 0,
        failures: [{ key: 'file/upload/granted_a.mp4', reason: 'EBUSY' }],
      });

      await expect(service.sweep()).resolves.toBeUndefined();
      expect(
        mockMetricsService.grantedCleanupSweepTotal.inc,
      ).not.toHaveBeenCalledWith({ outcome: 'deleted' }, expect.anything());
    });
  });

  describe('onModuleInit', () => {
    it('registers and starts a cron job when enabled', () => {
      const fakeJob = { start: jest.fn() };
      cronFrom.mockReturnValue(fakeJob);

      service.onModuleInit();

      expect(cronFrom).toHaveBeenCalledWith(
        expect.objectContaining({ cronTime: '0 0 * * *' }),
      );
      expect(mockSchedulerRegistry.addCronJob).toHaveBeenCalledWith(
        'orphan-granted-file-sweep',
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
