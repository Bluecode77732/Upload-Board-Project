import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditLogService } from './audit-log.service';
import { AuditLogEntity } from './audit-log.entity';
import { AuditTargetType } from './audit-target-type.enum';
import { AuditAction } from './dto/audit-log-query.dto';

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
    it('should persist a record with its target type and detail', async () => {
      await service.log(
        1,
        2,
        AuditTargetType.user,
        'ROLE_CHANGE',
        'user→admin',
      );

      expect(mockRepository.save).toHaveBeenCalledWith({
        actorId: 1,
        targetId: 2,
        targetType: AuditTargetType.user,
        action: 'ROLE_CHANGE',
        detail: 'user→admin',
      });
    });

    it('should default detail to null when omitted', async () => {
      await service.log(1, 2, AuditTargetType.user, 'USER_DELETE');

      expect(mockRepository.save).toHaveBeenCalledWith({
        actorId: 1,
        targetId: 2,
        targetType: AuditTargetType.user,
        action: 'USER_DELETE',
        detail: null,
      });
    });

    it('should persist a non-user target type as given (ADR 0045)', async () => {
      await service.log(1, 269, AuditTargetType.file, 'FILE_DELETE');

      expect(mockRepository.save).toHaveBeenCalledWith({
        actorId: 1,
        targetId: 269,
        targetType: AuditTargetType.file,
        action: 'FILE_DELETE',
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

    it('should OR the actor branch with a user-targeted branch when userId is given', async () => {
      mockRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ userId: 3, take: 20, skip: 0 });

      expect(mockRepository.findAndCount).toHaveBeenCalledWith({
        where: [
          { actorId: 3 },
          { targetId: 3, targetType: AuditTargetType.user },
        ],
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
          {
            action: 'ROLE_CHANGE',
            targetId: 3,
            targetType: AuditTargetType.user,
          },
        ],
        order: { createdAt: 'DESC' },
        take: 20,
        skip: 0,
      });
    });
  });

  // ADR 0045 regression: asserting the where *shape* above cannot show that the shape
  // actually excludes the wrong rows, so these run the produced where against fixtures.
  // The matcher mirrors the one TypeORM semantic this query relies on — a where array is
  // OR, an object's keys are AND — which is exactly what the service's comment claims.
  describe('findAll — polymorphic targetId (ADR 0045)', () => {
    type WhereBranch = Partial<Record<keyof AuditLogEntity, unknown>>;

    const row = (
      id: number,
      actorId: number,
      targetId: number,
      targetType: AuditTargetType,
      action: AuditAction,
    ): AuditLogEntity => ({
      id,
      actorId,
      targetId,
      targetType,
      action,
      detail: null,
      createdAt: new Date(),
    });

    // Every fixture below uses target id 269 on purpose: the reproduction case is a file
    // whose id happens to equal an unrelated user's id (observed 2026-08-23).
    const rows = [
      row(1, 7, 269, AuditTargetType.file, 'FILE_DELETE'),
      row(2, 7, 269, AuditTargetType.post, 'POST_DELETE'),
      row(3, 7, 269, AuditTargetType.comment, 'COMMENT_DELETE'),
      row(4, 7, 269, AuditTargetType.user, 'ROLE_CHANGE'),
      row(5, 269, 12, AuditTargetType.user, 'USER_DELETE'),
    ];

    const matches = (branch: WhereBranch, entry: AuditLogEntity): boolean =>
      Object.entries(branch).every(
        ([key, value]) => entry[key as keyof AuditLogEntity] === value,
      );

    beforeEach(() => {
      mockRepository.findAndCount.mockImplementation(
        (options: { where: WhereBranch | WhereBranch[] }) => {
          const branches = Array.isArray(options.where)
            ? options.where
            : [options.where];
          const matched = rows.filter((entry) =>
            branches.some((branch) => matches(branch, entry)),
          );
          return Promise.resolve([matched, matched.length]);
        },
      );
    });

    it('should not return file/post/comment records whose target id equals the user id', async () => {
      const [found] = await service.findAll({ userId: 269, take: 20, skip: 0 });

      // Rows 1-3 are the false positives: there 269 is a file/post/comment id, not a user
      // id. Row 4 (269 really was the role-change target) and row 5 (269 was the actor)
      // are legitimate and must survive.
      expect(found.map((entry) => entry.id).sort()).toEqual([4, 5]);
      expect(found.some((entry) => [1, 2, 3].includes(entry.id))).toBe(false);
    });

    it('should still return a record where the user really was the target', async () => {
      const [found] = await service.findAll({ userId: 12, take: 20, skip: 0 });

      expect(found.map((entry) => entry.id)).toEqual([5]);
    });

    it('should still return every record the user performed as actor', async () => {
      const [found] = await service.findAll({ userId: 7, take: 20, skip: 0 });

      expect(found.map((entry) => entry.id).sort()).toEqual([1, 2, 3, 4]);
    });
  });
});
