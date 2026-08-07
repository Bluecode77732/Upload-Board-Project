import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { HealthService } from './health.service';

describe('HealthService', () => {
  let healthService: HealthService;
  let dataSource: DataSource;

  const mockDataSource = {
    query: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    healthService = module.get<HealthService>(HealthService);
    dataSource = module.get<DataSource>(DataSource);

    jest.clearAllMocks();
  });

  describe('checkDatabase', () => {
    it('returns true when the database answers the ping', async () => {
      (dataSource.query as jest.Mock).mockResolvedValue([{ '?column?': 1 }]);

      await expect(healthService.checkDatabase()).resolves.toBe(true);
      expect(dataSource.query).toHaveBeenCalledWith('SELECT 1');
    });

    it('returns false, without throwing, when the database is unreachable', async () => {
      (dataSource.query as jest.Mock).mockRejectedValue(
        new Error('connection terminated'),
      );

      await expect(healthService.checkDatabase()).resolves.toBe(false);
    });
  });
});
