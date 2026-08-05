import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserEntity } from './entity/user.entity';
import * as bcrypt from 'bcrypt';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { UpdateUserDto } from './dto/update-user.dto';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { UserRole } from 'backend/auth/role/role';
import { AuditLogService } from 'backend/audit-log/audit-log.service';
import { FileService } from 'backend/file/file.service';
import { PostService } from 'backend/post/post.service';
import { CommentService } from 'backend/comment/comment.service';
import * as fs from 'fs/promises';

jest.mock('bcrypt');
jest.mock('fs/promises');

describe('UserService', () => {
  let userService: UserService;

  const mockUserRepository = {
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  const mockConfigService = {
    getOrThrow: jest.fn(),
  };

  // transaction(cb) and transaction(level, cb) both run the callback with a mocked
  // EntityManager — remove() uses the first form, updateRole() the second.
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

  // Only the two methods UserService.remove reaches into (module boundary: file rows
  // stay FileService's business even during an account cascade).
  const mockFileService = {
    findStoredPathsOfCreator: jest.fn(),
    deleteFilesOfCreator: jest.fn(),
  };

  // Same boundary for post rows during the cascade (ADR 0023 D5).
  const mockPostService = {
    deletePostsOfCreator: jest.fn().mockResolvedValue(0),
  };

  // ...and for comment rows, which go first: the account's comments on *other people's*
  // posts are unreachable through the post FK cascade (ADR 0023 D5).
  const mockCommentService = {
    deleteCommentsOfCreator: jest.fn(),
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
      ],
    }).compile();

    userService = module.get<UserService>(UserService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should forward take/skip and sort deterministically by createdAt DESC, id DESC', async () => {
      const rows = [{ id: 2 }, { id: 1 }];
      mockUserRepository.findAndCount.mockResolvedValue([rows, 2]);

      const result = await userService.findAll({ take: 10, skip: 5 });

      expect(mockUserRepository.findAndCount).toHaveBeenCalledWith({
        take: 10,
        skip: 5,
        order: { createdAt: 'DESC', id: 'DESC' },
      });
      expect(result).toEqual([rows, 2]);
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

      const user = { id: userId, email: 'email@gmail.com', password: hashed };

      jest
        .spyOn(mockUserRepository, 'findOne')
        .mockResolvedValueOnce(user)
        .mockResolvedValueOnce({ ...user, password: hashed });
      jest.spyOn(mockConfigService, 'getOrThrow').mockReturnValue(genSalt);
      (bcrypt.hash as jest.Mock).mockResolvedValue(hashed);
      jest.spyOn(mockUserRepository, 'update').mockResolvedValue(undefined);

      const originalPassword = updateUserDto.password;
      const result = await userService.update(userId, updateUserDto);

      expect(result).toEqual({ ...user, password: hashed });
      expect(bcrypt.hash).toHaveBeenCalledWith(originalPassword, genSalt);
      expect(mockUserRepository.update).toHaveBeenCalledWith(
        { id: userId },
        { email: updateUserDto.email, password: hashed },
      );
    });

    it("should throw NotFoundException when the user doesn't exist.", async () => {
      jest.spyOn(mockUserRepository, 'findOne').mockResolvedValue(null);

      await expect(userService.update(1, { email: 'x@y.com' })).rejects.toThrow(
        NotFoundException,
      );
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
      mockManager.findOne.mockResolvedValue({ id: 2, email: 'a@b.com' });
      (fs.unlink as jest.Mock).mockResolvedValue(undefined);
    });

    it('should delete a user who owns no files and audit files=0', async () => {
      mockFileService.findStoredPathsOfCreator.mockResolvedValue([]);

      const result = await userService.remove(1, 2);

      expect(mockFileService.deleteFilesOfCreator).not.toHaveBeenCalled();
      expect(mockManager.delete).toHaveBeenCalledWith(UserEntity, 2);
      expect(fs.unlink).not.toHaveBeenCalled();
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        1,
        2,
        'USER_DELETE',
        'files=0 posts=0',
      );
      expect(result).toBe('User 2 deleted.');
    });

    it('should delete comments, then posts, then files, counting posts in the audit detail', async () => {
      mockFileService.findStoredPathsOfCreator.mockResolvedValue(storedPaths);
      mockPostService.deletePostsOfCreator.mockResolvedValueOnce(4);

      await userService.remove(1, 2, true);

      // Comments go first: the account's comments on *other people's* posts are reachable
      // no other way, since the FK cascade only fires when the owning post goes.
      expect(
        mockCommentService.deleteCommentsOfCreator.mock.invocationCallOrder[0],
      ).toBeLessThan(
        mockPostService.deletePostsOfCreator.mock.invocationCallOrder[0],
      );
      expect(mockCommentService.deleteCommentsOfCreator).toHaveBeenCalledWith(
        mockManager,
        2,
      );
      // Posts next: FK_post_entity_file/creator are ON DELETE NO ACTION, so a
      // remaining post row would block both the file rows and the user row (ADR 0023 D5).
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
        'USER_DELETE',
        'files=2 posts=4',
      );
    });

    it('should refuse with ConflictException when files exist and the cascade is unconfirmed', async () => {
      mockFileService.findStoredPathsOfCreator.mockResolvedValue(storedPaths);

      await expect(userService.remove(1, 2)).rejects.toThrow(ConflictException);
      expect(mockFileService.deleteFilesOfCreator).not.toHaveBeenCalled();
      expect(mockManager.delete).not.toHaveBeenCalled();
      expect(fs.unlink).not.toHaveBeenCalled();
      expect(mockAuditLogService.log).not.toHaveBeenCalled();
    });

    it('should cascade into file rows and stored files once confirmed', async () => {
      mockFileService.findStoredPathsOfCreator.mockResolvedValue(storedPaths);

      const result = await userService.remove(1, 2, true);

      expect(mockFileService.deleteFilesOfCreator).toHaveBeenCalledWith(
        mockManager,
        2,
      );
      expect(mockManager.delete).toHaveBeenCalledWith(UserEntity, 2);
      // Stored files go only after the transaction returns (post-commit unlink).
      expect(fs.unlink).toHaveBeenCalledTimes(2);
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        1,
        2,
        'USER_DELETE',
        'files=2 posts=0',
      );
      expect(result).toBe('User 2 deleted.');
    });

    it('should still complete when a stored file cannot be unlinked', async () => {
      mockFileService.findStoredPathsOfCreator.mockResolvedValue(storedPaths);
      (fs.unlink as jest.Mock)
        .mockRejectedValueOnce(new Error('EACCES'))
        .mockResolvedValueOnce(undefined);

      const result = await userService.remove(1, 2, true);

      // The DB deletion is already committed — a failed unlink must not undo it.
      expect(result).toBe('User 2 deleted.');
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        1,
        2,
        'USER_DELETE',
        'files=2 posts=0',
      );
    });

    it('should throw NotFoundException when the user is missing', async () => {
      mockManager.findOne.mockResolvedValue(null);

      await expect(userService.remove(1, 2)).rejects.toThrow(NotFoundException);
      expect(mockManager.delete).not.toHaveBeenCalled();
      expect(mockAuditLogService.log).not.toHaveBeenCalled();
    });
  });
});
