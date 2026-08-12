import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditLogService } from './audit-log.service';
import { AuditLogEntity } from './audit-log.entity';

describe('AuditLogService', () => {
  let service: AuditLogService;

  const mockRepository = {
    save: jest.fn(),
    findAndCount: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogService,
        {
          provide: getRepositoryToken(AuditLogEntity),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<AuditLogService>(AuditLogService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('log', () => {
    it('should persist a record with detail', async () => {
      await service.log(1, 2, 'ROLE_CHANGE', 'user→admin');

      expect(mockRepository.save).toHaveBeenCalledWith({
        actorId: 1,
        targetId: 2,
        action: 'ROLE_CHANGE',
        detail: 'user→admin',
      });
    });

    it('should default detail to null when omitted', async () => {
      await service.log(1, 2, 'USER_DELETE');

      expect(mockRepository.save).toHaveBeenCalledWith({
        actorId: 1,
        targetId: 2,
        action: 'USER_DELETE',
        detail: null,
      });
    });
  });

  describe('findAll', () => {
    it('should filter by action and paginate', async () => {
      mockRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ action: 'ROLE_CHANGE', take: 10, skip: 5 });

      expect(mockRepository.findAndCount).toHaveBeenCalledWith({
        where: { action: 'ROLE_CHANGE' },
        order: { createdAt: 'DESC' },
        take: 10,
        skip: 5,
      });
    });

    it('should apply an empty where when no action filter is given', async () => {
      mockRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ take: 20, skip: 0 });

      expect(mockRepository.findAndCount).toHaveBeenCalledWith({
        where: {},
        order: { createdAt: 'DESC' },
        take: 20,
        skip: 0,
      });
    });

    it('should OR actorId/targetId when userId is given without an action', async () => {
      mockRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ userId: 3, take: 20, skip: 0 });

      expect(mockRepository.findAndCount).toHaveBeenCalledWith({
        where: [{ actorId: 3 }, { targetId: 3 }],
        order: { createdAt: 'DESC' },
        take: 20,
        skip: 0,
      });
    });

    it('should AND action onto each userId branch when both are given', async () => {
      mockRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.findAll({
        userId: 3,
        action: 'ROLE_CHANGE',
        take: 20,
        skip: 0,
      });

      expect(mockRepository.findAndCount).toHaveBeenCalledWith({
        where: [
          { action: 'ROLE_CHANGE', actorId: 3 },
          { action: 'ROLE_CHANGE', targetId: 3 },
        ],
        order: { createdAt: 'DESC' },
        take: 20,
        skip: 0,
      });
    });
  });
});
