import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserEntity } from './entity/user.entity';
import * as bcrypt from 'bcrypt';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { UpdateUserDto } from './dto/update-user.dto';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { UserRole } from 'backend/auth/role/role';
import { ErrorCode } from 'backend/common/error-code';
import { AuditLogService } from 'backend/audit-log/audit-log.service';
import { AuditTargetType } from 'backend/audit-log/audit-target-type.enum';
import { FileService } from 'backend/file/file.service';
import { PostService } from 'backend/post/post.service';
import { CommentService } from 'backend/comment/comment.service';
import {
  FILE_STORAGE,
  FileStorage,
} from 'backend/storage/file-storage.interface';

jest.mock('bcrypt');

describe('UserService', () => {
  let userService: UserService;
  let userRepository: Repository<UserEntity>;

  const mockUserRepository = {
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    createQueryBuilder: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  const mockConfigService = {
    getOrThrow: jest.fn(),
  };

  // transaction(cb)와 transaction(level, cb) 둘 다 mock EntityManager로 콜백을 실행한다 —
  // remove()는 첫 번째 형태를, updateRole()은 두 번째 형태를 쓴다.
  const mockManager = {
    findOne: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  type ManagerCallback = (manager: typeof mockManager) => unknown;
  const mockDataSource = {
    transaction: jest.fn(
      (levelOrCb: string | ManagerCallback, maybeCb?: ManagerCallback) => {
        const callback = typeof levelOrCb === 'function' ? levelOrCb : maybeCb;
        if (!callback)
          throw new Error('transaction() called without a callback');
        return callback(mockManager);
      },
    ),
  };

  const mockAuditLogService = {
    log: jest.fn(),
  };

  // UserService.remove가 손을 뻗는 건 이 두 메서드뿐이다 (모듈 경계: 계정 cascade 중에도
  // 파일 행은 여전히 FileService의 일이다).
  const mockFileService = {
    findStoredPathsOfCreator: jest.fn(),
    deleteFilesOfCreator: jest.fn(),
  };

  // cascade 동안 게시글 행에도 같은 경계가 적용된다 (ADR 0023 D5).
  const mockPostService = {
    deletePostsOfCreator: jest.fn().mockResolvedValue(0),
  };

  // ...그리고 댓글 행에도 — 댓글은 먼저 지워진다: 계정이 *다른 사람의* 게시글에 단 댓글은
  // 게시글 FK cascade로는 닿을 수 없다 (ADR 0023 D5).
  const mockCommentService = {
    deleteCommentsOfCreator: jest.fn(),
  };

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
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: getRepositoryToken(UserEntity),
          useValue: mockUserRepository,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: AuditLogService,
          useValue: mockAuditLogService,
        },
        {
          provide: FileService,
          useValue: mockFileService,
        },
        {
          provide: PostService,
          useValue: mockPostService,
        },
        {
          provide: CommentService,
          useValue: mockCommentService,
        },
        {
          provide: FILE_STORAGE,
          useValue: mockStorage,
        },
      ],
    }).compile();

    userService = module.get<UserService>(UserService);
    userRepository = module.get<Repository<UserEntity>>(
      getRepositoryToken(UserEntity),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    // 단순 `GET /user` 요청에 대해 전역 파이프가 컨트롤러에 넘겨줄 DTO 인스턴스.
    const listQuery = (overrides: Record<string, unknown> = {}) => ({
      take: 20,
      skip: 0,
      sortBy: 'createdAt' as const,
      order: 'DESC' as const,
      ...overrides,
    });

    let listQueryBuilder: Record<string, jest.Mock>;

    beforeEach(() => {
      listQueryBuilder = {
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        getManyAndCount: jest
          .fn()
          .mockResolvedValue([[{ id: 2 }, { id: 1 }], 2]),
      };
      jest
        .spyOn(userRepository, 'createQueryBuilder')
        .mockReturnValue(
          listQueryBuilder as unknown as SelectQueryBuilder<UserEntity>,
        );
    });

    it('should apply take and skip to the query', async () => {
      const result = await userService.findAll(
        listQuery({ take: 10, skip: 5 }),
      );

      expect(listQueryBuilder.take).toHaveBeenCalledWith(10);
      expect(listQueryBuilder.skip).toHaveBeenCalledWith(5);
      expect(result).toEqual([[{ id: 2 }, { id: 1 }], 2]);
    });

    it('should default to newest first with id as a tiebreaker', async () => {
      await userService.findAll(listQuery());

      expect(listQueryBuilder.orderBy).toHaveBeenCalledWith(
        'user.createdAt',
        'DESC',
      );
      expect(listQueryBuilder.addOrderBy).toHaveBeenCalledWith(
        'user.id',
        'DESC',
      );
    });

    it('should map an allowed sort key to its column instead of interpolating it', async () => {
      await userService.findAll(listQuery({ sortBy: 'email', order: 'ASC' }));

      expect(listQueryBuilder.orderBy).toHaveBeenCalledWith(
        'user.email',
        'ASC',
      );
      expect(listQueryBuilder.addOrderBy).toHaveBeenCalledWith(
        'user.id',
        'ASC',
      );
    });

    it('should not duplicate the tiebreaker when sorting by id', async () => {
      await userService.findAll(listQuery({ sortBy: 'id' }));

      expect(listQueryBuilder.orderBy).toHaveBeenCalledWith('user.id', 'DESC');
      expect(listQueryBuilder.addOrderBy).not.toHaveBeenCalled();
    });

    it('should search the email with a case-insensitive partial match', async () => {
      await userService.findAll(listQuery({ search: 'alice' }));

      expect(listQueryBuilder.andWhere).toHaveBeenCalledWith(
        "user.email ILIKE :term ESCAPE '\\'",
        { term: '%alice%' },
      );
    });

    it('should escape LIKE wildcards so they match literally', async () => {
      await userService.findAll(listQuery({ search: '100%_a\\b' }));

      expect(listQueryBuilder.andWhere).toHaveBeenCalledWith(
        "user.email ILIKE :term ESCAPE '\\'",
        { term: '%100\\%\\_a\\\\b%' },
      );
    });

    it('should ignore a whitespace-only search term', async () => {
      await userService.findAll(listQuery({ search: '   ' }));

      expect(listQueryBuilder.andWhere).not.toHaveBeenCalled();
    });
  });

  describe('findByEmail', () => {
    it('should return the user with an exact email match', async () => {
      const user = { id: 2, email: 'b@c.com' };
      jest.spyOn(mockUserRepository, 'findOne').mockResolvedValue(user);

      const result = await userService.findByEmail('b@c.com');

      expect(mockUserRepository.findOne).toHaveBeenCalledWith({
        where: { email: 'b@c.com' },
      });
      expect(result).toEqual(user);
    });

    it('should throw NotFoundException when no user has that email', async () => {
      jest.spyOn(mockUserRepository, 'findOne').mockResolvedValue(null);

      await expect(userService.findByEmail('nobody@c.com')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should update a user.', async () => {
      const updateUserDto: UpdateUserDto = {
        email: 'email@gmail.com',
        password: 'PrivatePassword',
      };

      const genSalt = 10;
      const userId = 1;
      const hashed = 'hashed_password';

      const user = {
        id: userId,
        email: 'email@gmail.com',
        password: hashed,
        role: UserRole.user,
      };

      jest
        .spyOn(mockUserRepository, 'findOne')
        .mockResolvedValueOnce(user)
        .mockResolvedValueOnce({ ...user, password: hashed });
      jest.spyOn(mockConfigService, 'getOrThrow').mockReturnValue(genSalt);
      (bcrypt.hash as jest.Mock).mockResolvedValue(hashed);
      jest.spyOn(mockUserRepository, 'update').mockResolvedValue(undefined);

      const originalPassword = updateUserDto.password;
      const result = await userService.update(
        userId,
        UserRole.user,
        userId,
        updateUserDto,
      );

      expect(result).toEqual({ ...user, password: hashed });
      expect(bcrypt.hash).toHaveBeenCalledWith(originalPassword, genSalt);
      expect(mockUserRepository.update).toHaveBeenCalledWith(
        { id: userId },
        { email: updateUserDto.email, password: hashed },
      );
    });

    it("should throw NotFoundException when the user doesn't exist.", async () => {
      jest.spyOn(mockUserRepository, 'findOne').mockResolvedValue(null);

      await expect(
        userService.update(1, UserRole.user, 1, { email: 'x@y.com' }),
      ).rejects.toThrow(NotFoundException);
      expect(mockUserRepository.update).not.toHaveBeenCalled();
    });

    it('should allow an admin to update a strictly lower-ranked account', async () => {
      const target = { id: 2, email: 'b@c.com', role: UserRole.user };
      jest
        .spyOn(mockUserRepository, 'findOne')
        .mockResolvedValueOnce(target)
        .mockResolvedValueOnce(target);
      jest.spyOn(mockUserRepository, 'update').mockResolvedValue(undefined);

      const result = await userService.update(1, UserRole.admin, 2, {
        email: 'b@c.com',
      });

      expect(mockUserRepository.update).toHaveBeenCalled();
      expect(result).toEqual(target);
    });

    it('should reject updating an account with an equal or higher role', async () => {
      const target = { id: 2, email: 'admin@b.com', role: UserRole.admin };
      jest.spyOn(mockUserRepository, 'findOne').mockResolvedValue(target);

      await expect(
        userService.update(1, UserRole.admin, 2, { email: 'x@y.com' }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockUserRepository.update).not.toHaveBeenCalled();
    });

    it('should reject a plain user (non-admin, non-owner) with FORBIDDEN_NOT_OWNER', async () => {
      const target = { id: 2, email: 'b@c.com', role: UserRole.user };
      jest.spyOn(mockUserRepository, 'findOne').mockResolvedValue(target);

      await expect(
        userService.update(1, UserRole.user, 2, { email: 'x@y.com' }),
      ).rejects.toMatchObject({
        response: { code: ErrorCode.FORBIDDEN_NOT_OWNER },
      });
      expect(mockUserRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('updateRole', () => {
    it('should change role, clear the session, and audit after commit', async () => {
      mockManager.findOne.mockResolvedValue({ id: 2, role: UserRole.user });
      mockManager.update.mockResolvedValue(undefined);

      const result = await userService.updateRole(1, 2, UserRole.admin);

      expect(mockManager.update).toHaveBeenCalledWith(UserEntity, 2, {
        role: UserRole.admin,
        refreshTokenHash: null,
      });
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        1,
        2,
        AuditTargetType.user,
        'ROLE_CHANGE',
        'user→admin',
      );
      expect(result).toEqual({ id: 2, role: UserRole.admin });
    });

    it('should throw NotFoundException when the target is missing', async () => {
      mockManager.findOne.mockResolvedValue(null);

      await expect(
        userService.updateRole(1, 99, UserRole.admin),
      ).rejects.toThrow(NotFoundException);
      expect(mockAuditLogService.log).not.toHaveBeenCalled();
    });

    it('should refuse to demote the last superadmin', async () => {
      mockManager.findOne.mockResolvedValue({
        id: 2,
        role: UserRole.superadmin,
      });
      mockManager.count.mockResolvedValue(1);

      await expect(
        userService.updateRole(1, 2, UserRole.admin),
      ).rejects.toThrow(BadRequestException);
      expect(mockManager.update).not.toHaveBeenCalled();
      expect(mockAuditLogService.log).not.toHaveBeenCalled();
    });

    it('should allow demoting a superadmin when another remains', async () => {
      mockManager.findOne.mockResolvedValue({
        id: 2,
        role: UserRole.superadmin,
      });
      mockManager.count.mockResolvedValue(2);
      mockManager.update.mockResolvedValue(undefined);

      await userService.updateRole(1, 2, UserRole.admin);

      expect(mockManager.update).toHaveBeenCalled();
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        1,
        2,
        AuditTargetType.user,
        'ROLE_CHANGE',
        'superadmin→admin',
      );
    });
  });

  describe('remove', () => {
    const storedPaths = [
      'file/upload/granted_a.mp4',
      'file/upload/granted_b.mp4',
    ];

    beforeEach(() => {
      mockManager.findOne.mockResolvedValue({
        id: 2,
        email: 'a@b.com',
        role: UserRole.user,
      });
      mockStorage.unlink.mockResolvedValue({ deleted: 0, failures: [] });
    });

    it('should delete a user who owns no files and audit files=0', async () => {
      mockFileService.findStoredPathsOfCreator.mockResolvedValue([]);

      const result = await userService.remove(1, UserRole.admin, 2);

      expect(mockFileService.deleteFilesOfCreator).not.toHaveBeenCalled();
      expect(mockManager.delete).toHaveBeenCalledWith(UserEntity, 2);
      expect(mockStorage.unlink).toHaveBeenCalledWith([]);
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        1,
        2,
        AuditTargetType.user,
        'USER_DELETE',
        'files=0 posts=0',
      );
      expect(result).toBe('User 2 deleted.');
    });

    it('should delete comments, then posts, then files, counting posts in the audit detail', async () => {
      mockFileService.findStoredPathsOfCreator.mockResolvedValue(storedPaths);
      mockPostService.deletePostsOfCreator.mockResolvedValueOnce(4);

      await userService.remove(1, UserRole.admin, 2, true);

      // 댓글이 먼저다: 계정이 *다른 사람의* 게시글에 단 댓글은, 게시글이 지워질 때만
      // FK cascade가 발동하므로 다른 방법으로는 닿을 수 없다.
      expect(
        mockCommentService.deleteCommentsOfCreator.mock.invocationCallOrder[0],
      ).toBeLessThan(
        mockPostService.deletePostsOfCreator.mock.invocationCallOrder[0],
      );
      expect(mockCommentService.deleteCommentsOfCreator).toHaveBeenCalledWith(
        mockManager,
        2,
      );
      // 다음은 게시글이다: FK_post_entity_file/creator가 ON DELETE NO ACTION이라,
      // 게시글 행이 남아 있으면 파일 행과 유저 행 둘 다 막힌다 (ADR 0023 D5).
      expect(
        mockPostService.deletePostsOfCreator.mock.invocationCallOrder[0],
      ).toBeLessThan(
        mockFileService.deleteFilesOfCreator.mock.invocationCallOrder[0],
      );
      expect(mockPostService.deletePostsOfCreator).toHaveBeenCalledWith(
        mockManager,
        2,
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        1,
        2,
        AuditTargetType.user,
        'USER_DELETE',
        'files=2 posts=4',
      );
    });

    it('should refuse with ConflictException when files exist and the cascade is unconfirmed', async () => {
      mockFileService.findStoredPathsOfCreator.mockResolvedValue(storedPaths);

      await expect(userService.remove(1, UserRole.admin, 2)).rejects.toThrow(
        ConflictException,
      );
      expect(mockFileService.deleteFilesOfCreator).not.toHaveBeenCalled();
      expect(mockManager.delete).not.toHaveBeenCalled();
      expect(mockStorage.unlink).not.toHaveBeenCalled();
      expect(mockAuditLogService.log).not.toHaveBeenCalled();
    });

    it('should cascade into file rows and stored files once confirmed', async () => {
      mockFileService.findStoredPathsOfCreator.mockResolvedValue(storedPaths);

      const result = await userService.remove(1, UserRole.admin, 2, true);

      expect(mockFileService.deleteFilesOfCreator).toHaveBeenCalledWith(
        mockManager,
        2,
      );
      expect(mockManager.delete).toHaveBeenCalledWith(UserEntity, 2);
      // 저장된 파일은 트랜잭션이 끝난 뒤에만 지워진다 (커밋 후 unlink).
      expect(mockStorage.unlink).toHaveBeenCalledWith(storedPaths);
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        1,
        2,
        AuditTargetType.user,
        'USER_DELETE',
        'files=2 posts=0',
      );
      expect(result).toBe('User 2 deleted.');
    });

    it('should still complete when a stored file cannot be unlinked', async () => {
      mockFileService.findStoredPathsOfCreator.mockResolvedValue(storedPaths);
      mockStorage.unlink.mockResolvedValue({
        deleted: 1,
        failures: [{ key: storedPaths[0], reason: 'EACCES' }],
      });

      const result = await userService.remove(1, UserRole.admin, 2, true);

      // DB 삭제는 이미 커밋됐다 — unlink 실패가 그걸 되돌려서는 안 된다.
      expect(result).toBe('User 2 deleted.');
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        1,
        2,
        AuditTargetType.user,
        'USER_DELETE',
        'files=2 posts=0',
      );
    });

    it('should throw NotFoundException when the user is missing', async () => {
      mockManager.findOne.mockResolvedValue(null);

      await expect(userService.remove(1, UserRole.admin, 2)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockManager.delete).not.toHaveBeenCalled();
      expect(mockAuditLogService.log).not.toHaveBeenCalled();
    });

    it('should reject deleting an account with an equal or higher role', async () => {
      mockManager.findOne.mockResolvedValue({
        id: 2,
        email: 'admin@b.com',
        role: UserRole.admin,
      });

      await expect(userService.remove(1, UserRole.admin, 2)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockFileService.findStoredPathsOfCreator).not.toHaveBeenCalled();
      expect(mockManager.delete).not.toHaveBeenCalled();
      expect(mockAuditLogService.log).not.toHaveBeenCalled();
    });

    it('should reject a plain user (non-admin, non-owner) with FORBIDDEN_NOT_OWNER', async () => {
      mockManager.findOne.mockResolvedValue({
        id: 2,
        email: 'b@c.com',
        role: UserRole.user,
      });

      await expect(
        userService.remove(1, UserRole.user, 2),
      ).rejects.toMatchObject({
        response: { code: ErrorCode.FORBIDDEN_NOT_OWNER },
      });
      expect(mockFileService.findStoredPathsOfCreator).not.toHaveBeenCalled();
      expect(mockManager.delete).not.toHaveBeenCalled();
      expect(mockAuditLogService.log).not.toHaveBeenCalled();
    });

    it('should allow self-deletion regardless of role', async () => {
      mockManager.findOne.mockResolvedValue({
        id: 2,
        email: 'super@b.com',
        role: UserRole.superadmin,
      });
      mockFileService.findStoredPathsOfCreator.mockResolvedValue([]);

      const result = await userService.remove(2, UserRole.superadmin, 2);

      expect(mockManager.delete).toHaveBeenCalledWith(UserEntity, 2);
      expect(result).toBe('User 2 deleted.');
    });
  });
});
